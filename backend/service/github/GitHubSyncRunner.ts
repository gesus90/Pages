import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import {
  canPushToGitHub,
  createEmptySyncCounters,
} from "@/backend/service/github/GitHubSyncRun";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { GitHubConflictResolver } from "@/backend/service/github/GitHubConflictResolver";
import type { GitHubExternalIssueDetector } from "@/backend/service/github/GitHubExternalIssueDetector";
import type { GitHubIssuePusher } from "@/backend/service/github/GitHubIssuePusher";
import type { GitHubPullRequestService } from "@/backend/service/github/GitHubPullRequestService";
import type { GitHubSyncAccessGuard } from "@/backend/service/github/GitHubSyncAccessGuard";
import type {
  GitHubSyncContext,
  GitHubSyncContextLoader,
} from "@/backend/service/github/GitHubSyncContextLoader";
import type { GitHubSyncCounters } from "@/backend/service/github/GitHubSyncRun";
import type { GitHubSyncSummary } from "@/definition/GitHub";
import type { ProjectIntegration } from "@/definition/Project";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Dependencies required to run GitHub synchronizations. */
export interface GitHubSyncRunnerOptions {
  readonly taskRepository: TaskRepository;
  readonly projectRepository: ProjectRepository;
  readonly userRepository: UserRepository;
  readonly accessGuard: GitHubSyncAccessGuard;
  readonly contextLoader: GitHubSyncContextLoader;
  readonly pusher: GitHubIssuePusher;
  readonly conflictResolver: GitHubConflictResolver;
  readonly externalIssueDetector: GitHubExternalIssueDetector;
  readonly pullRequestService: GitHubPullRequestService;
  readonly now: () => string;
}

/** Completed and failed counters of a scheduled batch of runs. */
export interface ScheduledSyncResult {
  readonly completed: number;
  readonly failed: number;
}

/** Shared state of one project run while its tasks are reconciled. */
interface ProjectRunState {
  readonly sync: GitHubSyncContext;
  readonly actor: User;
  readonly statuses: readonly WorkflowStatus[];
  readonly remoteByNumber: ReadonlyMap<number, GitHubIssueData>;
  readonly summary: GitHubSyncCounters;
}

/** Runs full, scheduled, and single-task synchronizations with GitHub. */
export class GitHubSyncRunner {
  private readonly taskRepository: TaskRepository;
  private readonly projectRepository: ProjectRepository;
  private readonly userRepository: UserRepository;
  private readonly accessGuard: GitHubSyncAccessGuard;
  private readonly contextLoader: GitHubSyncContextLoader;
  private readonly pusher: GitHubIssuePusher;
  private readonly conflictResolver: GitHubConflictResolver;
  private readonly externalIssueDetector: GitHubExternalIssueDetector;
  private readonly pullRequestService: GitHubPullRequestService;
  private readonly now: () => string;

  /**
   * Creates a synchronization runner.
   *
   * @param options - Repository, collaborator, and infrastructure dependencies.
   */
  public constructor(options: GitHubSyncRunnerOptions) {
    this.taskRepository = options.taskRepository;
    this.projectRepository = options.projectRepository;
    this.userRepository = options.userRepository;
    this.accessGuard = options.accessGuard;
    this.contextLoader = options.contextLoader;
    this.pusher = options.pusher;
    this.conflictResolver = options.conflictResolver;
    this.externalIssueDetector = options.externalIssueDetector;
    this.pullRequestService = options.pullRequestService;
    this.now = options.now;
  }

  /**
   * Synchronizes every task, issue, and pull request of one project.
   *
   * @param actor - User the run is attributed to.
   * @param projectId - Project to synchronize.
   * @returns Outcome counters describing the run.
   */
  public async runProject(
    actor: User,
    projectId: string,
  ): Promise<GitHubSyncSummary> {
    await this.accessGuard.requireWritableProject(actor, projectId);
    const visibility = await this.accessGuard.visibility(actor);
    const sync = await this.contextLoader.requireContext(projectId);
    const summary = createEmptySyncCounters();
    const timestamp = this.now();
    const tasks = await this.taskRepository.findAll({
      projectIds: [projectId],
      type: WORK_ITEM_TYPE.TASK,
      visibility,
    });
    const statuses = (await this.taskRepository.findAllStatuses()).filter(
      (status) => status.projectId === null || status.projectId === projectId,
    );
    const remoteIssues = sync.integration.syncIssues
      ? await sync.client.listIssues(sync.repo.owner, sync.repo.repo, "all")
      : [];
    const remoteByNumber = new Map(
      remoteIssues.map((issue) => [issue.number, issue]),
    );
    const state: ProjectRunState = {
      actor,
      remoteByNumber,
      statuses,
      summary,
      sync,
    };

    for (const item of tasks) {
      await this.synchronizeTask(state, item);
    }

    if (sync.integration.syncIssues) {
      await this.externalIssueDetector.detect(
        projectId,
        remoteByNumber,
        summary,
      );
    }

    if (sync.integration.syncPullRequests) {
      await this.pullRequestService.storeRemotePullRequests(
        sync,
        projectId,
        summary,
        visibility,
      );
    }

    await this.scheduleNextRun(projectId, sync.integration, timestamp);

    return summary;
  }

  /**
   * Synchronizes every project whose scheduled run is due.
   *
   * @returns Completed and failed run counters; failures never abort the batch.
   */
  public async runDue(): Promise<ScheduledSyncResult> {
    const timestamp = this.now();
    const due = await this.projectRepository.findDueSyncIntegrations(timestamp);
    let completed = 0;
    let failed = 0;

    for (const entry of due) {
      const owner = await this.userRepository.findById(entry.ownerId);

      if (!owner || !owner.isActive) {
        continue;
      }

      try {
        await this.runProject(owner, entry.projectId);
        completed += 1;
      } catch (error: unknown) {
        failed += 1;
        console.error(
          `Pages could not synchronize project "${entry.projectId}" with GitHub.`,
          error,
        );
      }
    }

    return { completed, failed };
  }

  /**
   * Synchronizes a single linked task without touching the rest of the project.
   *
   * @param actor - User triggering the run; must hold write permission.
   * @param workItemId - Linked task to synchronize.
   * @returns Outcome counters describing the run.
   */
  public async runSingleTask(
    actor: User,
    workItemId: string,
  ): Promise<GitHubSyncSummary> {
    const item = await this.accessGuard.requireWritableTask(actor, workItemId);

    if (item.githubIssueNumber === null) {
      throw new WorkItemValidationError("githubTaskNotLinked");
    }

    const sync = await this.contextLoader.requireContext(item.projectId);
    const summary = createEmptySyncCounters();

    await this.reconcileLinkedItem(sync, actor, item, summary);

    return summary;
  }

  private async synchronizeTask(
    state: ProjectRunState,
    item: WorkItemDetail,
  ): Promise<void> {
    const { actor, remoteByNumber, statuses, summary, sync } = state;

    if (item.githubIssueNumber === null) {
      // Only operational tasks become issues; initiatives and epics
      // structure the work and never sync automatically.
      if (
        item.type === WORK_ITEM_TYPE.TASK &&
        sync.integration.syncIssues &&
        canPushToGitHub(sync.integration)
      ) {
        await this.pusher.createRemoteIssue(sync, actor, item, summary);
      }

      return;
    }

    if (item.githubConflict) {
      return;
    }

    const remote = remoteByNumber.get(item.githubIssueNumber);

    if (!remote) {
      return;
    }

    await this.conflictResolver.reconcile(
      {
        actor,
        issueNumber: item.githubIssueNumber,
        item,
        remote,
        summary,
        sync,
      },
      statuses,
    );
  }

  private async reconcileLinkedItem(
    sync: GitHubSyncContext,
    actor: User,
    item: WorkItemDetail,
    summary: GitHubSyncCounters,
  ): Promise<void> {
    if (item.githubIssueNumber === null || item.githubConflict) {
      return;
    }

    const remote = await sync.client.getIssue(
      sync.repo.owner,
      sync.repo.repo,
      item.githubIssueNumber,
    );
    const statuses = (await this.taskRepository.findAllStatuses()).filter(
      (status) =>
        status.projectId === null || status.projectId === item.projectId,
    );

    await this.conflictResolver.reconcile(
      {
        actor,
        issueNumber: item.githubIssueNumber,
        item,
        remote,
        summary,
        sync,
      },
      statuses,
    );
  }

  private async scheduleNextRun(
    projectId: string,
    integration: ProjectIntegration,
    timestamp: string,
  ): Promise<void> {
    const interval = integration.syncIntervalMinutes;

    await this.projectRepository.updateSyncSchedule(projectId, {
      lastSyncAt: timestamp,
      nextSyncAt:
        interval > 0
          ? new Date(Date.parse(timestamp) + interval * 60_000).toISOString()
          : null,
    });
  }
}
