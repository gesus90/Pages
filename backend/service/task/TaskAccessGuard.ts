import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";
import { CAPABILITY } from "@/definition/Authorization";
import type { Capability } from "@/definition/Authorization";
import type { PermissionService } from "@/backend/auth/PermissionService";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { AuthorizationFacts } from "@/backend/service/project/ProjectAccessService";
import type { Project } from "@/definition/Project";
import type { WorkItemVisibility, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Verifies that an actor may reach, and change, projects and their work items. */
export class TaskAccessGuard {
  private readonly taskRepository: TaskRepository;
  private readonly projectService: ProjectService;
  private readonly permissions: PermissionService;

  /**
   * Creates an access guard.
   *
   * @param taskRepository - Task persistence boundary.
   * @param projectService - Project business-logic boundary deciding access.
   */
  public constructor(
    taskRepository: TaskRepository,
    projectService: ProjectService,
    permissions: PermissionService,
  ) {
    this.taskRepository = taskRepository;
    this.projectService = projectService;
    this.permissions = permissions;
  }

  /** Checks the global action capability without bypassing project visibility. */
  public async requireCapability(
    actor: User,
    capability: Capability,
  ): Promise<void> {
    if (!(await this.permissions.hasCapability(actor, capability)))
      throw new WorkItemAccessDeniedError();
  }

  /** Returns the project after verifying that the actor may see it. */
  public async requireProject(
    actor: User,
    projectId: string,
  ): Promise<Project> {
    return this.projectService.getById(actor, projectId);
  }

  /**
   * Verifies that the actor may see a project and change tickets in it.
   *
   * @remarks
   * The single write rule of tickets: current project access plus the global
   * `write` capability. Department scope is enforced where a concrete ticket
   * is loaded, see {@link TaskAccessGuard.requireWritableWorkItem}.
   *
   * @throws {WorkItemAccessDeniedError} When the actor lacks write permission.
   */
  public async requireWritableProject(
    actor: User,
    projectId: string,
  ): Promise<Project> {
    const project = await this.requireProject(actor, projectId);
    await this.requireCapability(actor, CAPABILITY.WRITE);

    return project;
  }

  /**
   * Returns a work item after verifying that the actor may see its project.
   *
   * @throws {WorkItemNotFoundError} When no such work item exists.
   */
  public async requireWorkItem(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemDetail> {
    const item = await this.taskRepository.findById(
      workItemId,
      await this.visibility(actor),
    );

    if (!item) {
      throw new WorkItemNotFoundError();
    }

    await this.requireProject(actor, item.projectId);

    return item;
  }

  /** Resolves current account facts and accessible projects for every ticket read. */
  public async visibility(actor: User): Promise<WorkItemVisibility> {
    return this.projectService.workItemVisibility(actor);
  }

  /** Keeps assignment candidates within their own current project read access. */
  public async filterAssignees(
    candidates: ReadonlyMap<string, readonly User[]>,
  ): Promise<ReadonlyMap<string, readonly User[]>> {
    return this.projectService.filterAssignees(candidates);
  }

  /** Verifies project-level planning access without adding milestone department rules. */
  public async requirePlanningProject(
    actor: User,
    projectId: string,
  ): Promise<void> {
    await this.requireProject(actor, projectId);
    if (!(await this.projectService.canWriteProject(actor, projectId))) {
      throw new WorkItemAccessDeniedError();
    }
  }

  /** Returns a work item the actor may see and change. */
  public async requireWritableWorkItem(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemDetail> {
    const item = await this.requireWorkItem(actor, workItemId);
    await this.requireCapability(actor, CAPABILITY.WRITE);

    return item;
  }

  /** Tells whether the actor currently holds the global write capability. */
  public async canWrite(actor: User): Promise<boolean> {
    return this.permissions.hasCapability(actor, CAPABILITY.WRITE);
  }

  /**
   * Tells whether the actor may archive tickets and milestones of a project.
   *
   * @remarks
   * The single archive rule of tickets and milestones: the role capability
   * "milestones" together with the project responsibility that milestone
   * planning needs. Ordinary write, assignment and membership rights alone do
   * not suffice, and neither does the capability without that responsibility.
   * Administrators in active administrator mode hold both. Both facts are
   * read freshly on every call, and the project access is part of the second.
   */
  public async canArchive(actor: User, projectId: string): Promise<boolean> {
    if (!(await this.holdsMilestoneRight(actor))) {
      return false;
    }

    return this.projectService.canWriteProject(actor, projectId);
  }

  /**
   * Verifies that the actor may archive in a project.
   *
   * @throws {WorkItemAccessDeniedError} Without the archive right there.
   */
  public async requireArchiveRight(
    actor: User,
    projectId: string,
  ): Promise<void> {
    if (!(await this.canArchive(actor, projectId))) {
      throw new WorkItemAccessDeniedError();
    }
  }

  /**
   * Returns a work item the actor may see and archive.
   *
   * @throws {WorkItemNotFoundError} When the ticket does not exist or is hidden.
   * @throws {WorkItemAccessDeniedError} Without the archive right in its project.
   */
  public async requireArchivableWorkItem(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemDetail> {
    const item = await this.requireWorkItem(actor, workItemId);
    await this.requireArchiveRight(actor, item.projectId);

    return item;
  }

  /**
   * Narrows projects to those the actor may archive in.
   *
   * @param actor - User asking.
   * @param projectIds - Projects to test, in the order they are returned.
   * @returns The projects of the list with the archive right; empty without
   * the capability, which is then tested only once.
   */
  public async archivableProjectIds(
    actor: User,
    projectIds: readonly string[],
  ): Promise<string[]> {
    if (!(await this.holdsMilestoneRight(actor))) {
      return [];
    }

    const archivable: string[] = [];

    for (const projectId of projectIds) {
      if (await this.projectService.canWriteProject(actor, projectId)) {
        archivable.push(projectId);
      }
    }

    return archivable;
  }

  /**
   * Tells whether the actor may archive in at least one of the projects.
   *
   * @remarks
   * Stops at the first project that qualifies, which is what the archive
   * filter needs to decide whether it is offered at all.
   */
  public async canArchiveAny(
    actor: User,
    projectIds: readonly string[],
  ): Promise<boolean> {
    if (!(await this.holdsMilestoneRight(actor))) {
      return false;
    }

    for (const projectId of projectIds) {
      if (await this.projectService.canWriteProject(actor, projectId)) {
        return true;
      }
    }

    return false;
  }

  /** Tells whether the actor may permanently delete tickets: active administrator mode only. */
  public async canDelete(actor: User): Promise<boolean> {
    return this.projectService.canDeleteProjects(actor);
  }

  /** Returns the live account and department catalog for department decisions. */
  public async authorizationFacts(actor: User): Promise<AuthorizationFacts> {
    return this.projectService.authorizationFacts(actor);
  }

  /**
   * Resolves the projects of a query to those the actor may see.
   *
   * @param actor - User asking.
   * @param requestedIds - Projects the caller asked for, or `undefined` for all of the actor.
   */
  public async resolveAccessibleProjectIds(
    actor: User,
    requestedIds?: readonly string[],
  ): Promise<string[]> {
    const accessibleProjects = await this.projectService.findAll(actor);
    const accessibleIds = new Set(
      accessibleProjects.map((project) => project.id),
    );

    if (!requestedIds) {
      return Array.from(accessibleIds);
    }

    return requestedIds.filter((id) => accessibleIds.has(id));
  }

  /** Tells whether the role of the actor, or the administrator mode, holds the capability "milestones". */
  private async holdsMilestoneRight(actor: User): Promise<boolean> {
    return this.permissions.hasCapability(actor, CAPABILITY.MILESTONES);
  }
}
