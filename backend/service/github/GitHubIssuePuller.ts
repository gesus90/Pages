import {
  buildLinkFromRemote,
  buildSyncHistoryEntry,
  buildWorkItemUpdateFromRemote,
  resolvePulledStatusId,
} from "@/backend/service/github/GitHubIssueMapping";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { LinkedIssueRun } from "@/backend/service/github/GitHubSyncRun";
import type { WorkflowStatus } from "@/definition/Task";

/** Pulls GitHub issue content into linked Pages tasks. */
export class GitHubIssuePuller {
  private readonly taskRepository: TaskRepository;
  private readonly now: () => string;

  /**
   * Creates an issue puller.
   *
   * @param taskRepository - Task persistence boundary receiving the changes.
   * @param now - Clock providing synchronization timestamps.
   */
  public constructor(taskRepository: TaskRepository, now: () => string) {
    this.taskRepository = taskRepository;
    this.now = now;
  }

  /**
   * Overwrites a task with the title, body, and state of its linked issue.
   *
   * @param run - Task, its issue, and the counters of the current run.
   * @param statuses - Workflow statuses the closed or reopened state maps onto.
   */
  public async pullRemoteState(
    run: LinkedIssueRun,
    statuses: readonly WorkflowStatus[],
  ): Promise<void> {
    const { actor, item, remote, summary } = run;
    const statusId = resolvePulledStatusId(item, remote, statuses);
    const timestamp = this.now();

    await this.taskRepository.updateFromGitHub(
      item.id,
      buildWorkItemUpdateFromRemote(item, remote, statusId),
    );
    await this.taskRepository.insertHistory(
      buildSyncHistoryEntry(actor.id, item.id, remote.number),
    );
    await this.taskRepository.updateGitHubLink(
      item.id,
      buildLinkFromRemote(remote, timestamp),
    );
    summary.pulled += 1;
  }
}
