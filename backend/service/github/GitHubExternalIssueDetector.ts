import { randomUUID } from "node:crypto";

import { applyProjectChange } from "./GitHubLocalChange";

import type { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { GitHubSyncCounters } from "@/backend/service/github/GitHubSyncRun";
import type { GitHubChangeEvents } from "./GitHubLocalChange";

/** Detects GitHub issues that have no Pages task yet. */
export class GitHubExternalIssueDetector {
  private readonly taskRepository: TaskRepository;
  private readonly gitHubRepository: GitHubRepository;
  private readonly events: GitHubChangeEvents;

  /**
   * Creates an external issue detector.
   *
   * @param taskRepository - Task persistence boundary listing linked tasks.
   * @param gitHubRepository - GitHub persistence boundary storing detections.
   * @param events - Stores a changed detection list with its event.
   */
  public constructor(
    taskRepository: TaskRepository,
    gitHubRepository: GitHubRepository,
    events: GitHubChangeEvents,
  ) {
    this.taskRepository = taskRepository;
    this.gitHubRepository = gitHubRepository;
    this.events = events;
  }

  /**
   * Stores issues that no task links to and refreshes already known ones.
   *
   * @param projectId - Project whose tasks are compared.
   * @param remoteByNumber - Remote issues of the repository by issue number.
   * @param summary - Counters of the current run.
   *
   * @remarks
   * Issues the user dismissed or imported are left untouched.
   */
  public async detect(
    projectId: string,
    remoteByNumber: ReadonlyMap<number, GitHubIssueData>,
    summary: GitHubSyncCounters,
  ): Promise<void> {
    const linkedNumbers =
      await this.taskRepository.findKnownGitHubIssueNumbers(projectId);

    // The remote issues were read before; the detection list of the project
    // changes in one transaction with one event, or not at all.
    await applyProjectChange(this.events, projectId, async () => {
      let isChanged = false;
      for (const remote of remoteByNumber.values()) {
        if (linkedNumbers.has(remote.number)) {
          continue;
        }

        const isRecorded = await this.recordExternalIssue(
          projectId,
          remote,
          summary,
        );
        isChanged = isRecorded || isChanged;
      }
      return isChanged;
    });
  }

  private async recordExternalIssue(
    projectId: string,
    remote: GitHubIssueData,
    summary: GitHubSyncCounters,
  ): Promise<boolean> {
    const existing = await this.gitHubRepository.findExternalIssueByNumber(
      projectId,
      remote.number,
    );

    if (existing?.dismissed || existing?.importedWorkItemId) {
      return false;
    }

    if (existing) {
      // An unchanged issue is not written again, so it changes nothing a reader sees.
      if (
        existing.state === remote.state &&
        existing.title === remote.title &&
        existing.url === remote.url
      )
        return false;
      await this.gitHubRepository.updateExternalIssue(existing.id, {
        state: remote.state,
        title: remote.title,
        url: remote.url,
      });
      return true;
    }

    await this.gitHubRepository.upsertExternalIssue({
      id: randomUUID(),
      issueNumber: remote.number,
      projectId,
      state: remote.state,
      title: remote.title,
      url: remote.url,
    });
    summary.detected += 1;
    return true;
  }
}
