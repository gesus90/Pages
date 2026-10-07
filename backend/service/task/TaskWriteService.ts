import { randomUUID } from "node:crypto";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import {
  trimOrNull,
  validateWorkItemText,
} from "@/backend/service/task/WorkItemValidation";
import { CAPABILITY } from "@/definition/Authorization";
import {
  isWorkItemPriority,
  isWorkItemType,
  WORK_ITEM_PRIORITY,
} from "@/definition/Task";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  NewWorkItem,
  TaskRepository,
} from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { TaskGitHubPublisher } from "@/backend/service/task/TaskGitHubPublisher";
import type {
  TaskHistoryRecorder,
  WorkItemUpdateValues,
} from "@/backend/service/task/TaskHistoryRecorder";
import type { WorkItemNumbering } from "@/backend/service/task/WorkItemNumbering";
import type { WorkItemReferenceValidator } from "@/backend/service/task/WorkItemReferenceValidator";
import type { Project } from "@/definition/Project";
import type {
  WorkItemDetail,
  WorkItemPriority,
  WorkItemType,
  WorkItemVisibility,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** Values required to create a new work item. */
export interface CreateWorkItemInput {
  readonly projectId: string;
  readonly type: WorkItemType;
  readonly title: string;
  readonly description?: string;
  readonly statusId: string;
  readonly priority?: WorkItemPriority;
  readonly assigneeId?: string | null;
  readonly parentId?: string | null;
  readonly milestoneId?: string | null;
  readonly dueAt?: string | null;
  readonly startAt?: string | null;
  readonly skipGitHubSync?: boolean;
}

/** Values that can be changed on an existing work item. */
export interface UpdateWorkItemInput {
  readonly title: string;
  readonly description: string;
  readonly statusId: string;
  readonly priority: WorkItemPriority;
  readonly assigneeId: string | null;
  readonly reporterId: string;
  readonly parentId: string | null;
  readonly milestoneId: string | null;
  readonly dueAt: string | null;
  readonly startAt: string | null;
}

/** Collaborators of the write service. */
export interface TaskWriteServiceDependencies {
  readonly taskRepository: TaskRepository;
  readonly access: TaskAccessGuard;
  readonly validator: WorkItemReferenceValidator;
  readonly numbering: WorkItemNumbering;
  readonly history: TaskHistoryRecorder;
  readonly gitHubPublisher: TaskGitHubPublisher;
  readonly cache: ServerCache;
}

interface UpdateReferenceScope {
  readonly visibility: WorkItemVisibility;
  readonly preservedParentId: string | null;
}

/** The values of a new work item that the caller decides, before it is numbered. */
type WorkItemDraft = Omit<
  NewWorkItem,
  "createdBy" | "id" | "key" | "number" | "sortOrder"
>;

/** Creates, changes, archives and restores work items. */
export class TaskWriteService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;
  private readonly validator: WorkItemReferenceValidator;
  private readonly numbering: WorkItemNumbering;
  private readonly history: TaskHistoryRecorder;
  private readonly gitHubPublisher: TaskGitHubPublisher;
  private readonly cache: ServerCache;

  /**
   * Creates a write service.
   *
   * @param dependencies - Collaborators the service writes through.
   */
  public constructor(dependencies: TaskWriteServiceDependencies) {
    this.taskRepository = dependencies.taskRepository;
    this.access = dependencies.access;
    this.validator = dependencies.validator;
    this.numbering = dependencies.numbering;
    this.history = dependencies.history;
    this.gitHubPublisher = dependencies.gitHubPublisher;
    this.cache = dependencies.cache;
  }

  /** Creates a new work item after validating hierarchy and project constraints. */
  public async create(
    actor: User,
    input: CreateWorkItemInput,
  ): Promise<WorkItemDetail> {
    const project = await this.access.requireProject(actor, input.projectId);
    await this.access.requireCapability(actor, CAPABILITY.WRITE);

    const title = input.title.trim();
    const description = (input.description ?? "").trim();
    const priority = input.priority ?? WORK_ITEM_PRIORITY.NORMAL;
    const parentId = trimOrNull(input.parentId);
    const milestoneId = trimOrNull(input.milestoneId);
    const assigneeId = trimOrNull(input.assigneeId);

    validateWorkItemText(title, description);

    if (!isWorkItemType(input.type)) {
      throw new WorkItemValidationError("Unsupported work item type.");
    }

    if (!isWorkItemPriority(priority)) {
      throw new WorkItemValidationError("Unsupported work item priority.");
    }

    const status = await this.taskRepository.findStatusById(input.statusId);

    if (
      !status ||
      (status.projectId !== null && status.projectId !== input.projectId)
    ) {
      throw new WorkItemValidationError("Selected status does not exist.");
    }

    await this.validator.validateReferences({
      assigneeId,
      milestoneId,
      parentId,
      projectId: input.projectId,
      selfId: null,
      type: input.type,
      visibility: await this.access.visibility(actor),
    });

    const id = await this.insertNumbered(actor, project, {
      assigneeId,
      description,
      dueAt: trimOrNull(input.dueAt),
      milestoneId,
      parentId,
      priority,
      projectId: input.projectId,
      startAt: trimOrNull(input.startAt),
      statusId: status.id,
      title,
      type: input.type,
    });
    this.cache.invalidateWorkItems();

    await this.history.recordCreated(actor, id);

    const created = await this.requireStored(
      id,
      "Created work item could not be retrieved.",
      actor,
    );

    if (!input.skipGitHubSync) {
      // Local-first: return the stored row immediately and synchronize
      // with GitHub in the background without blocking the UI.
      void this.gitHubPublisher.publish(actor, created);
    }

    return created;
  }

  /** Updates an existing work item after validating constraints and logging changes. */
  public async update(
    actor: User,
    id: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItemDetail> {
    const existing = await this.access.requireWorkItem(actor, id);
    await this.access.requireCapability(actor, CAPABILITY.WRITE);
    const hiddenParent =
      existing.parentId === null
        ? await this.taskRepository.findParentReference(id)
        : null;
    const original = hiddenParent
      ? { ...existing, parentId: hiddenParent.id, parentKey: hiddenParent.key }
      : existing;
    const values = await this.validateUpdate(original, input, {
      visibility: await this.access.visibility(actor),
      preservedParentId:
        hiddenParent && trimOrNull(input.parentId) === null
          ? hiddenParent.id
          : null,
    });

    await this.taskRepository.update(id, {
      assigneeId: values.assigneeId,
      description: values.description,
      dueAt: values.dueAt,
      milestoneId: values.milestoneId,
      parentId: values.parentId,
      priority: values.priority,
      reporterId: values.reporterId,
      startAt: values.startAt,
      statusId: values.newStatus.id,
      title: values.title,
    });
    this.cache.invalidateWorkItems();

    await this.history.recordUpdate(actor, original, values);

    const updated = await this.requireStored(
      id,
      "Updated work item could not be retrieved.",
      actor,
    );

    // Local-first: the stored update is already visible; GitHub follows async.
    void this.gitHubPublisher.publish(actor, updated);

    return updated;
  }

  /** Updates status and column sort order via kanban drag & drop. */
  public async updateStatusAndOrder(
    actor: User,
    id: string,
    statusId: string,
    sortOrder: number,
  ): Promise<WorkItemDetail> {
    const existing = await this.access.requireWorkItem(actor, id);
    await this.access.requireCapability(actor, CAPABILITY.WRITE);
    const status = await this.taskRepository.findStatusById(statusId);

    if (
      !status ||
      (status.projectId !== null && status.projectId !== existing.projectId)
    ) {
      throw new WorkItemValidationError("Target status does not exist.");
    }

    await this.taskRepository.updateStatusAndOrder(
      id,
      status.id,
      sortOrder,
      status.isDone,
    );
    this.cache.invalidateWorkItems();

    await this.history.recordStatusMove(actor, existing, status);

    const updated = await this.requireStored(
      id,
      "Work item could not be retrieved after status update.",
      actor,
    );

    // Local-first: kanban moves stay instant while GitHub syncs in background.
    void this.gitHubPublisher.publish(actor, updated);

    return updated;
  }

  /** Marks a work item as archived without physical deletion. */
  public async archive(actor: User, id: string): Promise<void> {
    await this.access.requireWorkItem(actor, id);
    await this.access.requireCapability(actor, CAPABILITY.WRITE);
    await this.taskRepository.archive(id);
    this.cache.invalidateWorkItems();

    await this.history.recordArchived(actor, id);
  }

  /** Restores an archived work item keeping its original workflow status. */
  public async restore(actor: User, id: string): Promise<void> {
    await this.access.requireWritableWorkItem(actor, id);
    await this.taskRepository.restore(id);
    this.cache.invalidateWorkItems();

    await this.history.recordRestored(actor, id);
  }

  private async validateUpdate(
    existing: WorkItemDetail,
    input: UpdateWorkItemInput,
    scope: UpdateReferenceScope,
  ): Promise<WorkItemUpdateValues> {
    const title = input.title.trim();
    const description = input.description.trim();
    const parentId = trimOrNull(input.parentId) ?? scope.preservedParentId;
    const milestoneId = trimOrNull(input.milestoneId);
    const assigneeId = trimOrNull(input.assigneeId);
    const reporterId = input.reporterId.trim();

    validateWorkItemText(title, description);

    if (!isWorkItemPriority(input.priority)) {
      throw new WorkItemValidationError("Unsupported work item priority.");
    }

    const newStatus = await this.taskRepository.findStatusById(input.statusId);

    if (
      !newStatus ||
      (newStatus.projectId !== null &&
        newStatus.projectId !== existing.projectId)
    ) {
      throw new WorkItemValidationError("Selected status does not exist.");
    }

    await this.validator.validateReferences({
      assigneeId,
      milestoneId,
      parentId,
      projectId: existing.projectId,
      selfId: existing.id,
      type: existing.type,
      ...scope,
    });

    if (!reporterId) {
      throw new WorkItemValidationError("A reporter must be selected.");
    }

    await this.validator.validateAssignee(reporterId, existing.projectId);

    return {
      assigneeId,
      description,
      dueAt: trimOrNull(input.dueAt),
      milestoneId,
      newStatus,
      parentId,
      priority: input.priority,
      reporterId,
      startAt: trimOrNull(input.startAt),
      title,
    };
  }

  private async insertNumbered(
    actor: User,
    project: Project,
    draft: WorkItemDraft,
  ): Promise<string> {
    return this.numbering.run(project, async (sequence) => {
      const id = randomUUID();

      await this.taskRepository.insert({
        ...draft,
        createdBy: actor.id,
        id,
        key: `${sequence.projectKey}-${sequence.firstNumber}`,
        number: sequence.firstNumber,
        sortOrder: sequence.firstNumber,
      });

      return id;
    });
  }

  private async requireStored(
    id: string,
    failureMessage: string,
    actor: User,
  ): Promise<WorkItemDetail> {
    const stored = await this.taskRepository.findById(
      id,
      await this.access.visibility(actor),
    );

    if (!stored) {
      throw new Error(failureMessage);
    }

    return stored;
  }
}
