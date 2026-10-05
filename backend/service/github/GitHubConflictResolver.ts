import { randomUUID } from "node:crypto";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import {
  hashRemoteIssueContent,
  hashWorkItemContent,
} from "@/backend/service/github/GitHubIssueMapping";
import {
  canPullFromGitHub,
  canPushToGitHub,
  createEmptySyncCounters,
} from "@/backend/service/github/GitHubSyncRun";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssuePuller } from "@/backend/service/github/GitHubIssuePuller";
import type { GitHubIssuePusher } from "@/backend/service/github/GitHubIssuePusher";
import type { GitHubSyncAccessGuard } from "@/backend/service/github/GitHubSyncAccessGuard";
import type { GitHubSyncContextLoader } from "@/backend/service/github/GitHubSyncContextLoader";
import type { LinkedIssueRun } from "@/backend/service/github/GitHubSyncRun";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Dependencies required to detect and resolve synchronization conflicts. */
export interface GitHubConflictResolverOptions {
  readonly taskRepository: TaskRepository;
  readonly projectRepository: ProjectRepository;
  readonly accessGuard: GitHubSyncAccessGuard;
  readonly contextLoader: GitHubSyncContextLoader;
  readonly pusher: GitHubIssuePusher;
  readonly puller: GitHubIssuePuller;
}

/** The side whose values win a synchronization conflict. */
export type GitHubConflictResolution = "pages" | "github";

/** Detects tasks that changed on both sides and resolves them on request. */
export class GitHubConflictResolver {
  private readonly taskRepository: TaskRepository;
  private readonly projectRepository: ProjectRepository;
  private readonly accessGuard: GitHubSyncAccessGuard;
  private readonly contextLoader: GitHubSyncContextLoader;
  private readonly pusher: GitHubIssuePusher;
  private readonly puller: GitHubIssuePuller;

  /**
   * Creates a conflict resolver.
   *
   * @param options - Repository and collaborator dependencies.
   */
  public constructor(options: GitHubConflictResolverOptions) {
    this.taskRepository = options.taskRepository;
    this.projectRepository = options.projectRepository;
    this.accessGuard = options.accessGuard;
    this.contextLoader = options.contextLoader;
    this.pusher = options.pusher;
    this.puller = options.puller;
  }

  /**
   * Synchronizes a linked task with its issue, flagging real conflicts.
   *
   * @param run - Task, its issue, and the counters of the current run.
   * @param statuses - Workflow statuses a pulled state maps onto.
   *
   * @remarks
   * A change on one side is carried over in the direction the integration
   * allows. A change on both sides is never overwritten; the task is flagged
   * and the project activity records the need for a manual decision.
   */
  public async reconcile(
    run: LinkedIssueRun,
    statuses: readonly WorkflowStatus[],
  ): Promise<void> {
    const { sync, item, remote } = run;
    const storedHash = item.githubContentHash;
    const pagesChanged =
      storedHash === null || hashWorkItemContent(item) !== storedHash;
    const remoteChanged =
      storedHash !== null && hashRemoteIssueContent(remote) !== storedHash;

    if (!pagesChanged && !remoteChanged) {
      return;
    }

    if (pagesChanged && remoteChanged) {
      await this.flagConflict(run);
      return;
    }

    if (pagesChanged && canPushToGitHub(sync.integration)) {
      await this.pusher.pushLocalState(run);
      return;
    }

    if (remoteChanged && canPullFromGitHub(sync.integration)) {
      await this.puller.pullRemoteState(run, statuses);
    }
  }

  /**
   * Resolves a synchronization conflict in favor of one side.
   *
   * @param actor - User resolving the conflict; must hold write permission.
   * @param workItemId - Task carrying the conflict flag.
   * @param resolution - Side whose values win the conflict.
   */
  public async resolve(
    actor: User,
    workItemId: string,
    resolution: GitHubConflictResolution,
  ): Promise<WorkItemDetail> {
    const item = await this.accessGuard.requireWritableTask(actor, workItemId);

    if (!item.githubConflict || item.githubIssueNumber === null) {
      throw new WorkItemValidationError("This task has no sync conflict.");
    }

    const sync = await this.contextLoader.requireContext(item.projectId);
    const remote = await sync.client.getIssue(
      sync.repo.owner,
      sync.repo.repo,
      item.githubIssueNumber,
    );
    const run: LinkedIssueRun = {
      actor,
      issueNumber: item.githubIssueNumber,
      item,
      remote,
      summary: createEmptySyncCounters(),
      sync,
    };

    await this.applyResolution(run, resolution);
    await this.taskRepository.setGitHubConflict(item.id, false);

    const resolved = await this.taskRepository.findById(item.id);

    if (!resolved) {
      throw new Error("Resolved task could not be retrieved.");
    }

    return resolved;
  }

  private async flagConflict(run: LinkedIssueRun): Promise<void> {
    const { actor, item, summary } = run;

    await this.taskRepository.setGitHubConflict(item.id, true);
    await this.projectRepository.insertActivity({
      action: "github_conflict",
      category: "integrations",
      id: randomUUID(),
      message: `Task ${item.key} changed in Pages and on GitHub and needs a manual decision.`,
      projectId: item.projectId,
      userId: actor.id,
    });
    summary.conflicts += 1;
  }

  private async applyResolution(
    run: LinkedIssueRun,
    resolution: GitHubConflictResolution,
  ): Promise<void> {
    if (resolution === "pages") {
      await this.pusher.pushLocalState(run);
      return;
    }

    const statuses = await this.taskRepository.findAllStatuses();

    await this.puller.pullRemoteState(run, statuses);
  }
}
