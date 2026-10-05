import { randomUUID } from "node:crypto";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import type { GitHubSyncAccessGuard } from "@/backend/service/github/GitHubSyncAccessGuard";
import type { GitHubSyncContext } from "@/backend/service/github/GitHubSyncContextLoader";
import type { GitHubSyncCounters } from "@/backend/service/github/GitHubSyncRun";
import type { TaskService } from "@/backend/service/TaskService";
import type { User } from "@/definition/User";

/** Stores GitHub pull requests and assigns them to Pages tasks. */
export class GitHubPullRequestService {
  private readonly gitHubRepository: GitHubRepository;
  private readonly accessGuard: GitHubSyncAccessGuard;
  private readonly taskService: TaskService;

  /**
   * Creates a pull request service.
   *
   * @param gitHubRepository - GitHub persistence boundary storing pull requests.
   * @param accessGuard - Verifier of write permission on the project.
   * @param taskService - Task business-logic boundary resolving tasks.
   */
  public constructor(
    gitHubRepository: GitHubRepository,
    accessGuard: GitHubSyncAccessGuard,
    taskService: TaskService,
  ) {
    this.gitHubRepository = gitHubRepository;
    this.accessGuard = accessGuard;
    this.taskService = taskService;
  }

  /**
   * Stores every pull request of the remote repository.
   *
   * @param sync - Resolved repository, token, and client.
   * @param projectId - Project receiving the pull requests.
   * @param summary - Counters of the current run.
   */
  public async storeRemotePullRequests(
    sync: GitHubSyncContext,
    projectId: string,
    summary: GitHubSyncCounters,
  ): Promise<void> {
    const remotePullRequests = await sync.client.listPullRequests(
      sync.repo.owner,
      sync.repo.repo,
      "all",
    );

    for (const pullRequest of remotePullRequests) {
      await this.gitHubRepository.upsertPullRequest({
        branch: pullRequest.branch,
        id: randomUUID(),
        merged: pullRequest.merged,
        number: pullRequest.number,
        projectId,
        state: pullRequest.state,
        title: pullRequest.title,
        url: pullRequest.url,
      });
    }

    summary.pullRequests += remotePullRequests.length;
  }

  /**
   * Assigns a pull request to a task or clears its assignment.
   *
   * @param actor - User assigning the pull request; must hold write permission.
   * @param pullRequestId - Stored pull request to assign.
   * @param workItemId - Task receiving the reference, or `null` to clear it.
   */
  public async assign(
    actor: User,
    pullRequestId: string,
    workItemId: string | null,
  ): Promise<void> {
    const pullRequest =
      await this.gitHubRepository.findPullRequestById(pullRequestId);

    if (!pullRequest) {
      throw new WorkItemValidationError(
        "This pull request cannot be assigned.",
      );
    }

    await this.accessGuard.requireWritableProject(actor, pullRequest.projectId);

    if (workItemId !== null) {
      const item = await this.taskService.getById(actor, workItemId);

      if (item.projectId !== pullRequest.projectId) {
        throw new WorkItemValidationError(
          "Pull requests can only reference tasks of the same project.",
        );
      }
    }

    await this.gitHubRepository.assignPullRequest(pullRequestId, workItemId);
  }
}
