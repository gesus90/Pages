import { randomUUID } from "node:crypto";

import { WorkItemTemplatePolicy } from "@/backend/auth/WorkItemTemplatePolicy";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { CAPABILITY } from "@/definition/Authorization";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type {
  NewWorkItemTemplate,
  WorkItemTemplateRepository,
} from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type { CreateWorkItemInput } from "@/backend/service/task/TaskWriteService";
import type { AuthorizationFacts } from "@/backend/service/project/ProjectAccessService";
import type { User } from "@/definition/User";
import type { WorkItemDetail } from "@/definition/Task";
import type {
  TemplateDetailsInput,
  TemplateSharing,
  WorkItemTemplate,
  WorkItemTemplateView,
} from "@/definition/WorkItemTemplate";

const MAXIMUM_TEMPLATE_NAME_LENGTH = 80;

/** Everything one decision about a template needs to know about the actor. */
interface ActorScope {
  readonly facts: AuthorizationFacts;
  readonly projectIds: ReadonlySet<string>;
}

/** Keeps only the ids the chosen scope uses, so a template never carries stale shares. */
function normalizeSharing(sharing: TemplateSharing): TemplateSharing {
  return {
    departmentIds:
      sharing.scope === TEMPLATE_SCOPE.DEPARTMENTS
        ? [...new Set(sharing.departmentIds)]
        : [],
    projectIds:
      sharing.scope === TEMPLATE_SCOPE.PROJECTS
        ? [...new Set(sharing.projectIds)]
        : [],
    scope: sharing.scope,
  };
}

function parseName(name: string): string {
  const trimmed = name.trim();

  if (trimmed === "" || trimmed.length > MAXIMUM_TEMPLATE_NAME_LENGTH) {
    throw new WorkItemValidationError(
      "Template name must be between 1 and 80 characters.",
    );
  }

  return trimmed;
}

/** Saves, shares and instantiates ticket templates. */
export class TaskTemplateService {
  private readonly repository: WorkItemTemplateRepository;
  private readonly taskService: TaskService;
  private readonly projectService: ProjectService;
  private readonly permissions: PermissionService;
  private readonly policy = new WorkItemTemplatePolicy();

  /**
   * Creates a template service.
   *
   * @param repository - Template persistence boundary.
   * @param taskService - Ticket boundary that reads and creates tickets.
   * @param projectService - Project boundary that decides project access.
   * @param permissions - Authorization boundary for the write capability.
   */
  public constructor(
    repository: WorkItemTemplateRepository,
    taskService: TaskService,
    projectService: ProjectService,
    permissions: PermissionService,
  ) {
    this.repository = repository;
    this.taskService = taskService;
    this.projectService = projectService;
    this.permissions = permissions;
  }

  /** Returns the templates the actor may use, each with the decision on managing it. */
  public async findVisible(actor: User): Promise<WorkItemTemplateView[]> {
    const scope = await this.scopeOf(actor);
    const templates = await this.repository.findAll();

    return templates
      .filter((template) =>
        this.policy.canView(scope.facts.account, template, scope.projectIds),
      )
      .map((template) => ({
        ...template,
        canManage: this.policy.canManage(scope.facts.account, template),
      }));
  }

  /**
   * Saves the content of a ticket as a new template owned by the actor.
   *
   * @param actor - User with write permission who may see the ticket.
   * @param ticketId - Ticket whose content becomes the template.
   * @param input - Name and audience of the template.
   * @throws {WorkItemAccessDeniedError} When the actor may not write or share that way.
   * @throws {WorkItemValidationError} When the name or the audience is invalid.
   */
  public async saveFromTicket(
    actor: User,
    ticketId: string,
    input: TemplateDetailsInput,
  ): Promise<void> {
    await this.requireWrite(actor);

    const ticket = await this.taskService.getById(actor, ticketId);
    const labels = await this.taskService.findLabelsForWorkItems([ticket.id]);
    const checklist = await this.taskService.findChecklistItems(
      actor,
      ticket.id,
    );
    const details = await this.validate(actor, input);
    const template: NewWorkItemTemplate = {
      ...details,
      checklist: checklist.map((item) => item.title),
      description: ticket.description,
      id: randomUUID(),
      labelIds: (labels.get(ticket.id) ?? []).map((label) => label.id),
      ownerId: actor.id,
      priority: ticket.priority,
      title: ticket.title,
      type: ticket.type,
    };

    await this.repository.save(template);
  }

  /**
   * Renames a template and changes whom it is shared with.
   *
   * @throws {WorkItemNotFoundError} When the template does not exist or is not visible.
   * @throws {WorkItemAccessDeniedError} When the actor is neither owner nor administrator.
   */
  public async update(
    actor: User,
    templateId: string,
    input: TemplateDetailsInput,
  ): Promise<void> {
    await this.requireWrite(actor);

    const { scope, template } = await this.requireVisible(actor, templateId);

    if (!this.policy.canManage(scope.facts.account, template)) {
      throw new WorkItemAccessDeniedError();
    }

    await this.repository.save({
      ...template,
      ...(await this.validate(actor, input)),
    });
  }

  /**
   * Deletes a template; its owner and the administrator mode may.
   *
   * @throws {WorkItemNotFoundError} When the template does not exist or is not visible.
   * @throws {WorkItemAccessDeniedError} When the actor is neither owner nor administrator.
   */
  public async delete(actor: User, templateId: string): Promise<void> {
    const { scope, template } = await this.requireVisible(actor, templateId);

    if (!this.policy.canManage(scope.facts.account, template)) {
      throw new WorkItemAccessDeniedError();
    }

    await this.repository.delete(template.id);
  }

  /**
   * Creates a ticket and applies the labels and checklist of a template to it.
   *
   * @param actor - User creating the ticket; the usual ticket write rules apply.
   * @param templateId - Template the actor may see.
   * @param input - Values of the new ticket, as the form submitted them.
   * @returns The created ticket.
   * @throws {WorkItemNotFoundError} When the template does not exist or is not visible.
   */
  public async createFromTemplate(
    actor: User,
    templateId: string,
    input: CreateWorkItemInput,
  ): Promise<WorkItemDetail> {
    const { template } = await this.requireVisible(actor, templateId);
    const ticket = await this.taskService.create(actor, input);

    for (const labelId of template.labelIds) {
      await this.taskService.assignLabel(actor, ticket.id, labelId);
    }

    for (const title of template.checklist) {
      await this.taskService.addChecklistItem(actor, ticket.id, title);
    }

    return ticket;
  }

  private async scopeOf(actor: User): Promise<ActorScope> {
    const [facts, projects] = await Promise.all([
      this.projectService.authorizationFacts(actor),
      this.projectService.findAll(actor),
    ]);

    return {
      facts,
      projectIds: new Set(projects.map((project) => project.id)),
    };
  }

  private async requireWrite(actor: User): Promise<void> {
    if (!(await this.permissions.hasCapability(actor, CAPABILITY.WRITE))) {
      throw new WorkItemAccessDeniedError();
    }
  }

  private async requireVisible(
    actor: User,
    templateId: string,
  ): Promise<{ scope: ActorScope; template: WorkItemTemplate }> {
    const scope = await this.scopeOf(actor);
    const template = await this.repository.findById(templateId);

    if (
      !template ||
      !this.policy.canView(scope.facts.account, template, scope.projectIds)
    ) {
      throw new WorkItemNotFoundError();
    }

    return { scope, template };
  }

  private async validate(
    actor: User,
    input: TemplateDetailsInput,
  ): Promise<TemplateDetailsInput> {
    const name = parseName(input.name);
    const sharing = normalizeSharing(input);
    const scope = await this.scopeOf(actor);
    const knownDepartments = new Set(
      scope.facts.departments.map((department) => department.id),
    );

    if (
      (sharing.scope === TEMPLATE_SCOPE.DEPARTMENTS &&
        sharing.departmentIds.length === 0) ||
      (sharing.scope === TEMPLATE_SCOPE.PROJECTS &&
        sharing.projectIds.length === 0)
    ) {
      throw new WorkItemValidationError(
        "Select at least one department or project to share with.",
      );
    }

    if (!sharing.departmentIds.every((id) => knownDepartments.has(id))) {
      throw new WorkItemValidationError("Selected department does not exist.");
    }

    if (!this.policy.canShare(scope.facts.account, sharing, scope.projectIds)) {
      throw new WorkItemAccessDeniedError();
    }

    return { name, ...sharing };
  }
}
