import {
  buildLinkFromRemote,
  buildSyncHistoryEntry,
  buildWorkItemUpdateFromRemote,
  resolvePulledStatusId,
} from "@/backend/service/github/GitHubIssueMapping";

import { applyTicketChange } from "@/backend/service/github/GitHubLocalChange";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubChangeEvents } from "@/backend/service/github/GitHubLocalChange";
import type { LinkedIssueRun } from "@/backend/service/github/GitHubSyncRun";
import type { WorkflowStatus } from "@/definition/Task";

/** Pulls GitHub issue content into linked Pages tasks. */
export class GitHubIssuePuller {
  private readonly taskRepository: TaskRepository;
  private readonly now: () => string;
  private readonly events: GitHubChangeEvents;

  /**
   * Creates an issue puller.
   *
   * @param taskRepository - Task persistence boundary receiving the changes.
   * @param now - Clock providing synchronization timestamps.
   * @param events - Stores each pulled change with its event.
   */
  public constructor(
    taskRepository: TaskRepository,
    now: () => string,
    events: GitHubChangeEvents,
  ) {
    this.taskRepository = taskRepository;
    this.now = now;
    this.events = events;
  }

  /**
   * Overwrites a task with the title, body, and state of its linked issue.
   *
   * @param run - Task, its issue, and the counters of the current run.
   * @param statuses - Workflow statuses the closed or reopened state maps onto.
   * @param alsoApply - Further local writes of the same change, such as
   * clearing a resolved conflict; they commit with the ticket and the event.
   */
  public async pullRemoteState(
    run: LinkedIssueRun,
    statuses: readonly WorkflowStatus[],
    alsoApply?: () => Promise<void>,
  ): Promise<void> {
    const { actor, item, remote, summary } = run;
    const statusId = resolvePulledStatusId(item, remote, statuses);
    const timestamp = this.now();

    // The issue was read before; ticket, history and link commit with the event.
    await applyTicketChange(this.events, item.id, async () => {
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
      await alsoApply?.();
    });
    summary.pulled += 1;
  }
}
