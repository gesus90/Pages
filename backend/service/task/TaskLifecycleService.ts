import {
  WorkItemAccessDeniedError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type { User } from "@/definition/User";

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

  /** Marks a work item and its descendants as archived without physical deletion. */
  public async archive(actor: User, id: string): Promise<void> {
    const ids = await this.requireWritableSubtree(actor, id);

    await this.taskRepository.archiveMany(ids);
    this.cache.invalidateWorkItems();

    for (const itemId of ids) {
      await this.history.recordArchived(actor, itemId);
    }
  }

  /** Restores an archived work item and its descendants keeping their workflow status. */
  public async restore(actor: User, id: string): Promise<void> {
    const ids = await this.requireWritableSubtree(actor, id);

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
   * @throws {WorkItemAccessDeniedError} When the actor is not an active administrator.
   */
  public async deletePermanently(actor: User, id: string): Promise<void> {
    if (!(await this.access.canDelete(actor))) {
      throw new WorkItemAccessDeniedError();
    }

    await this.access.requireWorkItem(actor, id);
    await this.taskRepository.deleteSubtree(id);
    this.cache.invalidateWorkItems();
    this.cache.invalidateLabels();
    this.cache.invalidateGitHub();
  }

  /**
   * Collects the subtree an archive change touches after the write check.
   *
   * @throws {WorkItemValidationError} When descendants lie outside the actor's
   * ticket scope, because they must not change unseen.
   */
  private async requireWritableSubtree(
    actor: User,
    id: string,
  ): Promise<string[]> {
    await this.access.requireWritableWorkItem(actor, id);

    const ids = await this.taskRepository.findSubtreeIds(id);
    const visibleIds = await this.taskRepository.findSubtreeIds(
      id,
      await this.access.visibility(actor),
    );

    if (visibleIds.length !== ids.length) {
      throw new WorkItemValidationError(
        "The ticket has descendants that are not visible to you.",
      );
    }

    return ids;
  }
}
