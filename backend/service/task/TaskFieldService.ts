import {
  WorkItemConflictError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import {
  trimOrNull,
  validateTitle,
} from "@/backend/service/task/WorkItemValidation";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { WorkItemConflictField } from "@/backend/error/WorkItemErrors";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { TaskGitHubPublisher } from "@/backend/service/task/TaskGitHubPublisher";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type { WorkItemReferenceValidator } from "@/backend/service/task/WorkItemReferenceValidator";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** A new title together with the title it was written from. */
export interface TitleChange {
  readonly title: string;
  readonly baseTitle: string;
}

/** A new status together with the status the ticket was in when it was read. */
export interface StatusChange {
  readonly statusId: string;
  readonly baseStatusId: string;
}

/** A new parent together with the parent the ticket had when it was read. */
export interface ParentChange {
  readonly parentId: string | null;
  readonly baseParentId: string | null;
}

/** Collaborators of the field service. */
export interface TaskFieldServiceDependencies {
  readonly taskRepository: TaskRepository;
  readonly access: TaskAccessGuard;
  readonly validator: WorkItemReferenceValidator;
  readonly history: TaskHistoryRecorder;
  readonly gitHubPublisher: TaskGitHubPublisher;
  readonly cache: ServerCache;
}

/** Refuses changes of an archived work item. */
function assertActive(item: WorkItemDetail): void {
  if (item.archivedAt !== null) {
    throw new WorkItemValidationError("ticketArchived");
  }
}

/**
 * Refuses a change written from an outdated value, unless the stored value
 * already is the new one.
 *
 * @throws {WorkItemConflictError} When the field changed since it was read.
 */
function assertCurrent<Value>(
  field: WorkItemConflictField,
  stored: Value,
  base: Value,
  next: Value,
): void {
  if (stored !== base && stored !== next) {
    throw new WorkItemConflictError(field);
  }
}

/**
 * Changes one field of a work item, only while it still holds the value the
 * caller read.
 *
 * @remarks
 * The comparison happens in the conditional statement itself, so a field
 * that someone else saved meanwhile is never overwritten. Every other field,
 * and the position among the tickets of a column, stays as it is.
 */
export class TaskFieldService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;
  private readonly validator: WorkItemReferenceValidator;
  private readonly history: TaskHistoryRecorder;
  private readonly gitHubPublisher: TaskGitHubPublisher;
  private readonly cache: ServerCache;

  /**
   * Creates a field service.
   *
   * @param dependencies - Collaborators the service writes through.
   */
  public constructor(dependencies: TaskFieldServiceDependencies) {
    this.taskRepository = dependencies.taskRepository;
    this.access = dependencies.access;
    this.validator = dependencies.validator;
    this.history = dependencies.history;
    this.gitHubPublisher = dependencies.gitHubPublisher;
    this.cache = dependencies.cache;
  }

  /**
   * Replaces the title of a work item.
   *
   * @param actor - The person changing it; needs write access to the ticket.
   * @param id - Work item identifier.
   * @param change - The new title and the title it was written from.
   * @returns The stored work item; unchanged when it already has the title.
   * @throws {WorkItemConflictError} When another title was saved meanwhile.
   * @throws {WorkItemValidationError} When the ticket is archived or the title unusable.
   */
  public async updateTitle(
    actor: User,
    id: string,
    change: TitleChange,
  ): Promise<WorkItemDetail> {
    const existing = await this.access.requireWritableWorkItem(actor, id);
    const title = change.title.trim();

    assertActive(existing);
    validateTitle(title);
    assertCurrent("title", existing.title, change.baseTitle, title);

    if (title === existing.title) {
      return existing;
    }

    if (!(await this.taskRepository.updateTitle(id, title, change.baseTitle))) {
      throw new WorkItemConflictError("title");
    }

    this.cache.invalidateWorkItems();
    await this.history.recordTitleChanged(actor, existing, title);

    return this.publishStored(actor, id);
  }

  /**
   * Moves a work item to another status without touching any other field.
   *
   * @param actor - The person changing it; needs write access to the ticket.
   * @param id - Work item identifier.
   * @param change - The new status and the status the ticket was read in.
   * @returns The stored work item; unchanged when it already has the status.
   * @throws {WorkItemConflictError} When the status changed meanwhile.
   * @throws {WorkItemValidationError} When the ticket is archived or the status does not fit its project.
   *
   * @remarks
   * The sort order is kept as it is: no position is invented and no other
   * ticket is touched. The ticket stands in the new column where its own
   * order value places it.
   */
  public async updateStatus(
    actor: User,
    id: string,
    change: StatusChange,
  ): Promise<WorkItemDetail> {
    const existing = await this.access.requireWritableWorkItem(actor, id);

    assertActive(existing);
    const status = await this.taskRepository.findStatusById(change.statusId);

    if (
      !status ||
      (status.projectId !== null && status.projectId !== existing.projectId)
    ) {
      throw new WorkItemValidationError("targetStatusNotFound");
    }

    assertCurrent("status", existing.statusId, change.baseStatusId, status.id);

    if (status.id === existing.statusId) {
      return existing;
    }

    if (
      !(await this.taskRepository.updateStatus(id, status, change.baseStatusId))
    ) {
      throw new WorkItemConflictError("status");
    }

    this.cache.invalidateWorkItems();
    await this.history.recordStatusMove(actor, existing, status);

    return this.publishStored(actor, id);
  }

  /**
   * Moves a work item below another parent, or removes its parent.
   *
   * @param actor - The person changing it; needs write access to the ticket.
   * @param id - Work item identifier.
   * @param change - The new parent and the parent as the actor saw it.
   * @returns The stored work item; unchanged when it already has the parent.
   * @throws {WorkItemConflictError} When the parent changed meanwhile.
   * @throws {WorkItemHierarchyError} When the parent does not fit the type,
   * lies in another project, is hidden or archived.
   * @throws {WorkItemValidationError} When the ticket is archived.
   *
   * @remarks
   * A parent the actor cannot see counts as no parent for the comparison and
   * stays when the actor names none, as with every other edit.
   */
  public async updateParent(
    actor: User,
    id: string,
    change: ParentChange,
  ): Promise<WorkItemDetail> {
    const existing = await this.access.requireWritableWorkItem(actor, id);

    assertActive(existing);

    const hiddenParent =
      existing.parentId === null
        ? await this.taskRepository.findParentReference(id)
        : null;
    const storedParentId = hiddenParent?.id ?? existing.parentId;
    const nextParentId =
      trimOrNull(change.parentId) ?? hiddenParent?.id ?? null;

    assertCurrent(
      "parent",
      existing.parentId,
      trimOrNull(change.baseParentId),
      trimOrNull(change.parentId),
    );

    if (nextParentId === storedParentId) {
      return existing;
    }

    await this.validator.validateHierarchy({
      parentId: nextParentId,
      projectId: existing.projectId,
      selfId: id,
      storedParentId,
      type: existing.type,
      visibility: await this.access.visibility(actor),
    });

    if (
      !(await this.taskRepository.replaceParent(
        id,
        nextParentId,
        storedParentId,
      ))
    ) {
      throw new WorkItemConflictError("parent");
    }

    this.cache.invalidateWorkItems();
    await this.history.recordParentChanged(actor, {
      newParentId: nextParentId,
      oldParentKey: existing.parentKey,
      workItemId: id,
    });

    return this.requireStored(actor, id);
  }

  private async publishStored(
    actor: User,
    id: string,
  ): Promise<WorkItemDetail> {
    const updated = await this.requireStored(actor, id);

    // Local-first: the stored change is already visible; GitHub follows async.
    void this.gitHubPublisher.publish(actor, updated);

    return updated;
  }

  private async requireStored(
    actor: User,
    id: string,
  ): Promise<WorkItemDetail> {
    const stored = await this.taskRepository.findById(
      id,
      await this.access.visibility(actor),
    );

    if (!stored) {
      throw new Error("Work item could not be retrieved after its change.");
    }

    return stored;
  }
}
