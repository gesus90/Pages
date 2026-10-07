import { randomUUID } from "node:crypto";

import type { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { GitHubSyncCounters } from "@/backend/service/github/GitHubSyncRun";

/** Detects GitHub issues that have no Pages task yet. */
export class GitHubExternalIssueDetector {
  private readonly taskRepository: TaskRepository;
  private readonly gitHubRepository: GitHubRepository;

  /**
   * Creates an external issue detector.
   *
   * @param taskRepository - Task persistence boundary listing linked tasks.
   * @param gitHubRepository - GitHub persistence boundary storing detections.
   */
  public constructor(
    taskRepository: TaskRepository,
    gitHubRepository: GitHubRepository,
  ) {
    this.taskRepository = taskRepository;
    this.gitHubRepository = gitHubRepository;
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

    for (const remote of remoteByNumber.values()) {
      if (linkedNumbers.has(remote.number)) {
        continue;
      }

      await this.recordExternalIssue(projectId, remote, summary);
    }
  }

  private async recordExternalIssue(
    projectId: string,
    remote: GitHubIssueData,
    summary: GitHubSyncCounters,
  ): Promise<void> {
    const existing = await this.gitHubRepository.findExternalIssueByNumber(
      projectId,
      remote.number,
    );

    if (existing?.dismissed || existing?.importedWorkItemId) {
      return;
    }

    if (existing) {
      await this.gitHubRepository.updateExternalIssue(existing.id, {
        state: remote.state,
        title: remote.title,
        url: remote.url,
      });
      return;
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
  }
}
