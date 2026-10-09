import {
  WorkItemAccessDeniedError,
  WorkItemHierarchyError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { isWorkItemType, WORK_ITEM_TYPE } from "@/definition/Task";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { DescendantCount } from "@/backend/database/repositories/task/WorkItemLifecycleRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type {
  ChildHandling,
  WorkItemDescendants,
  WorkItemDetail,
  WorkItemType,
  WorkItemTypeCounts,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** Counts per type with every type at zero. */
function emptyCounts(): Record<WorkItemType, number> {
  return { epic: 0, initiative: 0, subtask: 0, task: 0 };
}

/** Sums descendant counts per type, optionally only the active ones. */
function sumCounts(
  counts: readonly DescendantCount[],
  onlyActive: boolean,
): WorkItemTypeCounts {
  const sums = emptyCounts();

  for (const count of counts) {
    if (isWorkItemType(count.type) && (count.isActive || !onlyActive)) {
      sums[count.type] += count.count;
    }
  }

  return sums;
}

/** Archives, restores and permanently deletes work items together with their descendants. */
export class TaskLifecycleService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;
  private readonly history: TaskHistoryRecorder;
  private readonly cache: ServerCache;

  /**
   * Creates a lifecycle service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Guard enforcing the ticket write and delete rules.
   * @param history - Recorder of the ticket audit trail.
   * @param cache - Shared server cache invalidated by every change.
   */
  public constructor(
    taskRepository: TaskRepository,
    access: TaskAccessGuard,
    history: TaskHistoryRecorder,
    cache: ServerCache,
  ) {
    this.taskRepository = taskRepository;
    this.access = access;
    this.history = history;
    this.cache = cache;
  }

  /**
   * Tells which descendants an archive or a deletion of a work item reaches.
   *
   * @param actor - The person asking; counts cover what they can see.
   * @param id - Work item identifier.
   * @returns The active and all descendants per type.
   */
  public async describeDescendants(
    actor: User,
    id: string,
  ): Promise<WorkItemDescendants> {
    await this.access.requireWorkItem(actor, id);

    const counts = await this.taskRepository.countDescendants(
      id,
      await this.access.visibility(actor),
    );

    return { active: sumCounts(counts, true), all: sumCounts(counts, false) };
  }

  /**
   * Archives a work item without physical deletion.
   *
   * @param actor - The person archiving; needs write access.
   * @param id - Work item identifier.
   * @param handling - `include` archives every active descendant too; `keep`
   * leaves the active direct children in place without a parent.
   * @throws {WorkItemValidationError} When descendants are hidden from the
   * actor, or subtasks would be left without their task.
   */
  public async archive(
    actor: User,
    id: string,
    handling: ChildHandling = "include",
  ): Promise<void> {
    const item = await this.access.requireWritableWorkItem(actor, id);
    let ids = await this.requireVisibleSubtree(actor, id);

    if (handling === "keep") {
      await this.releaseChildren(actor, item, "active");
      ids = [id];
    }

    await this.taskRepository.archiveMany(ids);
    this.cache.invalidateWorkItems();

    for (const itemId of ids) {
      await this.history.recordArchived(actor, itemId);
    }
  }

  /**
   * Restores an archived work item and its descendants keeping their workflow status.
   *
   * @throws {WorkItemHierarchyError} With `parentArchived` while the parent is
   * still archived, because the work item would hang below it unseen.
   */
  public async restore(actor: User, id: string): Promise<void> {
    const item = await this.access.requireWritableWorkItem(actor, id);
    const ids = await this.requireVisibleSubtree(actor, id);

    await this.assertParentActive(item);
    await this.taskRepository.restoreMany(ids);
    this.cache.invalidateWorkItems();

    for (const itemId of ids) {
      await this.history.recordRestored(actor, itemId);
    }
  }

  /**
   * Permanently removes a work item, its descendants and all data tied to them.
   *
   * @param actor - User in active administrator mode.
   * @param id - Work item starting the removed subtree.
   * @param handling - `include` deletes every descendant; `keep` keeps all
   * direct children, archived ones included, without a parent.
   * @returns The storage names of the attachment files the removed work
   * items had, which the caller removes from the disk.
   * @throws {WorkItemAccessDeniedError} When the actor is not an active administrator.
   */
  public async deletePermanently(
    actor: User,
    id: string,
    handling: ChildHandling = "include",
  ): Promise<string[]> {
    if (!(await this.access.canDelete(actor))) {
      throw new WorkItemAccessDeniedError();
    }

    const item = await this.access.requireWorkItem(actor, id);

    if (handling === "keep") {
      await this.requireVisibleSubtree(actor, id);
      await this.releaseChildren(actor, item, "all");
    }

    const storageNames = await this.taskRepository.findSubtreeStorageNames(id);

    await this.taskRepository.deleteSubtree(id);
    this.cache.invalidateWorkItems();
    this.cache.invalidateLabels();
    this.cache.invalidateGitHub();

    return storageNames;
  }

  /**
   * Collects the subtree a change touches.
   *
   * @throws {WorkItemValidationError} When descendants lie outside the actor's
   * ticket scope, because they must not change unseen.
   */
  private async requireVisibleSubtree(
    actor: User,
    id: string,
  ): Promise<string[]> {
    const ids = await this.taskRepository.findSubtreeIds(id);
    const visibleIds = await this.taskRepository.findSubtreeIds(
      id,
      await this.access.visibility(actor),
    );

    if (visibleIds.length !== ids.length) {
      throw new WorkItemValidationError("descendantsHidden");
    }

    return ids;
  }

  /** Releases the direct children of a work item and records it on each child. */
  private async releaseChildren(
    actor: User,
    item: WorkItemDetail,
    scope: "active" | "all",
  ): Promise<void> {
    if (item.type === WORK_ITEM_TYPE.TASK) {
      throw new WorkItemValidationError("subtasksStayWithTask");
    }

    const released = await this.taskRepository.detachChildren(item.id, scope);

    for (const childId of released) {
      await this.history.recordParentChanged(actor, {
        newParentId: null,
        oldParentKey: item.key,
        workItemId: childId,
      });
    }
  }

  private async assertParentActive(item: WorkItemDetail): Promise<void> {
    const parentId =
      item.parentId ??
      (await this.taskRepository.findParentReference(item.id))?.id ??
      null;

    if (parentId === null) {
      return;
    }

    const parent = await this.taskRepository.findById(parentId);

    if (parent?.archivedAt) {
      throw new WorkItemHierarchyError("parentArchived");
    }
  }
}
