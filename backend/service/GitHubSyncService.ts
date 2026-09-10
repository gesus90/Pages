import { createHash, randomUUID } from "node:crypto";

import {
  CACHE_TTLS,
  ServerCache,
  stableIdKey,
} from "@/backend/cache/ServerCache";
import { decryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { GitHubApiClient } from "@/backend/github/GitHubApiClient";
import { ProjectManagementDeniedError } from "@/backend/service/ProjectService";
import { WorkItemValidationError } from "@/backend/service/TaskService";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type {
  GitHubExternalIssue,
  GitHubPullRequest,
  GitHubSyncSummary,
} from "@/definition/GitHub";
import type { ProjectIntegration } from "@/definition/Project";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Dependencies required by the GitHub synchronization service. */
export interface GitHubSyncServiceOptions {
  readonly taskRepository: TaskRepository;
  readonly projectRepository: ProjectRepository;
  readonly gitHubRepository: GitHubRepository;
  readonly userRepository: UserRepository;
  readonly projectService: ProjectService;
  readonly taskService: TaskService;
  readonly createClient?: (token: string) => GitHubApiClient;
  readonly tokenKey: Buffer;
  readonly now?: () => string;
  readonly cache?: ServerCache;
}

/**
 * Creates a live GitHub API client.
 *
 * @param token - Personal access token, kept inside the server process.
 * @returns Client speaking to the GitHub REST API.
 */
export function createGitHubApiClient(token: string): GitHubApiClient {
  return new GitHubApiClient(token);
}

/**
 * Returns the current timestamp for synchronization bookkeeping.
 *
 * @returns Current time as an ISO string.
 */
export function currentGitHubSyncTime(): string {
  return new Date().toISOString();
}

/** A GitHub repository address split into owner and name. */
export interface GitHubRepositoryRef {
  readonly owner: string;
  readonly repo: string;
}

/** Authenticated sync prerequisites resolved for one project. */
export interface GitHubSyncContext {
  readonly integration: ProjectIntegration;
  readonly repo: GitHubRepositoryRef;
  readonly client: GitHubApiClient;
}

interface GitHubSyncCounters {
  pushed: number;
  pulled: number;
  created: number;
  detected: number;
  conflicts: number;
  pullRequests: number;
}

interface GitHubIssuePatch {
  title?: string;
  body?: string;
  state?: "open" | "closed";
}

/**
 * Splits a repository address into its owner and name segments.
 *
 * @param repoUrl - Repository address from the integration settings.
 * @returns Owner and name, or `null` when the address is invalid.
 */
export function parseGitHubRepository(
  repoUrl: string,
): GitHubRepositoryRef | null {
  const match = repoUrl
    .trim()
    .match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/);

  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return { owner: match[1], repo: match[2] };
}

/**
 * Hashes the synchronized triple so later runs detect real changes.
 *
 * @param title - Pages title or GitHub issue title.
 * @param description - Pages description or GitHub issue body.
 * @param isDone - Whether the Pages task is done or the issue is closed.
 * @returns Hex-encoded content hash shared by both sides.
 */
export function computeGitHubContentHash(
  title: string,
  description: string,
  isDone: boolean,
): string {
  return createHash("sha256")
    .update(`${title}\n${description}\n${isDone ? "closed" : "open"}`)
    .digest("hex");
}

/**
 * Maps a Pages completion state onto a GitHub issue state.
 *
 * @param isDone - Whether the Pages task reached a done status.
 * @returns The corresponding GitHub issue state.
 */
export function mapPagesToGitHubState(isDone: boolean): "open" | "closed" {
  return isDone ? "closed" : "open";
}

/** Establishes the business-logic boundary for GitHub synchronization. */
export class GitHubSyncService {
  private readonly taskRepository: TaskRepository;
  private readonly projectRepository: ProjectRepository;
  private readonly gitHubRepository: GitHubRepository;
  private readonly userRepository: UserRepository;
  private readonly projectService: ProjectService;
  private readonly taskService: TaskService;
  private readonly createClient: (token: string) => GitHubApiClient;
  private readonly tokenKey: Buffer;
  private readonly now: () => string;
  private readonly cache: ServerCache;

  /**
   * Creates a GitHub synchronization service.
   *
   * @param options - Repository, service, and infrastructure dependencies.
   */
  public constructor(options: GitHubSyncServiceOptions) {
    this.taskRepository = options.taskRepository;
    this.projectRepository = options.projectRepository;
    this.gitHubRepository = options.gitHubRepository;
    this.userRepository = options.userRepository;
    this.projectService = options.projectService;
    this.taskService = options.taskService;
    this.createClient = options.createClient ?? createGitHubApiClient;
    this.tokenKey = options.tokenKey;
    this.now = options.now ?? currentGitHubSyncTime;
    this.cache = options.cache ?? ServerCache.disabled();
  }

  /**
   * Runs a full bidirectional synchronization for one project.
   *
   * @param actor - User triggering the run; must hold write permission.
   * @param projectId - Project to synchronize.
   * @returns Outcome counters describing the run.
   */
  public async syncProjectNow(
    actor: User,
    projectId: string,
  ): Promise<GitHubSyncSummary> {
    await this.projectService.getById(actor, projectId);

    if (!(await this.projectService.canWriteProject(actor, projectId))) {
      throw new ProjectManagementDeniedError();
    }

    return this.runProjectSync(actor, projectId);
  }

  /**
   * Synchronizes every project whose scheduled run is due.
   *
   * @returns Completed and failed run counters; failures never abort the batch.
   */
  public async runScheduledSyncs(): Promise<{
    readonly completed: number;
    readonly failed: number;
  }> {
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
        await this.runProjectSync(owner, entry.projectId);
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
  public async syncSingleTask(
    actor: User,
    workItemId: string,
  ): Promise<GitHubSyncSummary> {
    const item = await this.taskService.getById(actor, workItemId);

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new ProjectManagementDeniedError();
    }

    if (item.githubIssueNumber === null) {
      throw new WorkItemValidationError(
        "This task is not linked to a GitHub issue.",
      );
    }

    const sync = await this.loadSyncContext(item.projectId);

    if (!sync) {
      throw new Error("GitHub integration is not connected.");
    }

    const summary = this.emptySummary();

    await this.reconcileLinkedItem(sync, actor, item, summary);

    return summary;
  }

  /**
   * Pushes one task to GitHub, creating the remote issue when missing.
   *
   * @param actor - User owning the change.
   * @param item - Fresh task detail after its Pages mutation.
   */
  public async publishTaskUpdate(
    actor: User,
    item: WorkItemDetail,
  ): Promise<void> {
    if (item.type !== WORK_ITEM_TYPE.TASK || item.githubConflict) {
      return;
    }

    const sync = await this.loadSyncContext(item.projectId);

    if (!sync || !this.canPush(sync.integration)) {
      return;
    }

    if (item.githubIssueNumber === null) {
      if (!sync.integration.syncIssues) {
        return;
      }

      await this.createRemoteIssue(sync, actor, item, this.emptySummary());
      return;
    }

    const remote = await sync.client.getIssue(
      sync.repo.owner,
      sync.repo.repo,
      item.githubIssueNumber,
    );

    await this.pushLocalState(
      sync,
      actor,
      item,
      item.githubIssueNumber,
      remote,
      this.emptySummary(),
    );
  }

  /**
   * Imports a detected external issue as a new Pages task and links both sides.
   *
   * @param actor - User importing the issue; must hold write permission.
   * @param projectId - Project receiving the new task.
   * @param issueNumber - Remote issue number to import.
   * @returns The created and linked task.
   */
  public async importExternalIssue(
    actor: User,
    projectId: string,
    issueNumber: number,
  ): Promise<WorkItemDetail> {
    await this.projectService.getById(actor, projectId);

    if (!(await this.projectService.canWriteProject(actor, projectId))) {
      throw new ProjectManagementDeniedError();
    }

    const external = await this.gitHubRepository.findExternalIssueByNumber(
      projectId,
      issueNumber,
    );

    if (!external || external.dismissed || external.importedWorkItemId) {
      throw new WorkItemValidationError(
        "This GitHub issue cannot be imported.",
      );
    }

    const sync = await this.loadSyncContext(projectId);

    if (!sync) {
      throw new Error("GitHub integration is not connected.");
    }

    const remote = await sync.client.getIssue(
      sync.repo.owner,
      sync.repo.repo,
      external.issueNumber,
    );
    const statuses = await this.taskRepository.findAllStatuses();
    const openStatus =
      statuses.find((status) => status.key === "backlog") ??
      statuses.find((status) => !status.isDone) ??
      statuses[0];

    if (!openStatus) {
      throw new Error("No workflow status is available for imported tasks.");
    }

    const created = await this.taskService.create(actor, {
      description: remote.body,
      dueAt: null,
      milestoneId: null,
      parentId: null,
      priority: "normal",
      projectId,
      statusId: openStatus.id,
      title: remote.title,
      type: WORK_ITEM_TYPE.TASK,
      skipGitHubSync: true,
    });
    const timestamp = this.now();

    await this.taskRepository.updateGitHubLink(created.id, {
      conflict: false,
      contentHash: computeGitHubContentHash(
        remote.title,
        remote.body,
        remote.state === "closed",
      ),
      issueNumber: remote.number,
      issueState: remote.state,
      issueUpdatedAt: remote.updatedAt,
      issueUrl: remote.url,
      lastSyncAt: timestamp,
    });
    await this.gitHubRepository.markExternalIssueImported(
      external.id,
      created.id,
    );
    await this.taskRepository.insertHistory({
      action: "github_sync",
      field: "github",
      id: randomUUID(),
      newValue: `#${remote.number}`,
      oldValue: null,
      userId: actor.id,
      workItemId: created.id,
    });

    const linked = await this.taskRepository.findById(created.id);

    if (!linked) {
      throw new Error("Imported task could not be retrieved.");
    }

    return linked;
  }

  /**
   * Links a detected external issue to an existing task.
   *
   * @param actor - User linking the issue; must hold write permission.
   * @param workItemId - Task receiving the link.
   * @param externalId - Detected external issue to link.
   */
  public async linkExternalIssue(
    actor: User,
    workItemId: string,
    externalId: string,
  ): Promise<WorkItemDetail> {
    const item = await this.taskService.getById(actor, workItemId);

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new ProjectManagementDeniedError();
    }

    if (item.type !== WORK_ITEM_TYPE.TASK) {
      throw new WorkItemValidationError(
        "Only tasks can be linked to a GitHub issue.",
      );
    }

    if (item.githubIssueNumber !== null) {
      throw new WorkItemValidationError(
        "This task is already linked to a GitHub issue.",
      );
    }

    const external =
      await this.gitHubRepository.findExternalIssueById(externalId);

    if (
      !external ||
      external.projectId !== item.projectId ||
      external.dismissed ||
      external.importedWorkItemId
    ) {
      throw new WorkItemValidationError("This GitHub issue cannot be linked.");
    }

    const sync = await this.loadSyncContext(item.projectId);

    if (!sync) {
      throw new Error("GitHub integration is not connected.");
    }

    const remote = await sync.client.getIssue(
      sync.repo.owner,
      sync.repo.repo,
      external.issueNumber,
    );
    const timestamp = this.now();

    await this.taskRepository.update(item.id, {
      assigneeId: item.assigneeId,
      description: remote.body,
      dueAt: item.dueAt,
      milestoneId: item.milestoneId,
      parentId: item.parentId,
      priority: item.priority,
      reporterId: item.createdBy,
      startAt: item.startAt,
      statusId: item.statusId,
      title: remote.title,
    });
    await this.taskRepository.updateGitHubLink(item.id, {
      conflict: false,
      contentHash: computeGitHubContentHash(
        remote.title,
        remote.body,
        remote.state === "closed",
      ),
      issueNumber: remote.number,
      issueState: remote.state,
      issueUpdatedAt: remote.updatedAt,
      issueUrl: remote.url,
      lastSyncAt: timestamp,
    });
    await this.gitHubRepository.markExternalIssueImported(external.id, item.id);
    await this.taskRepository.insertHistory({
      action: "github_sync",
      field: "github",
      id: randomUUID(),
      newValue: `#${remote.number}`,
      oldValue: null,
      userId: actor.id,
      workItemId: item.id,
    });

    const linked = await this.taskRepository.findById(item.id);

    if (!linked) {
      throw new Error("Linked task could not be retrieved.");
    }

    return linked;
  }

  /**
   * Hides a detected external issue without importing it.
   *
   * @param actor - User dismissing the issue; must hold write permission.
   * @param externalId - Detected external issue to dismiss.
   */
  public async dismissExternalIssue(
    actor: User,
    externalId: string,
  ): Promise<void> {
    const external =
      await this.gitHubRepository.findExternalIssueById(externalId);

    if (!external) {
      throw new WorkItemValidationError(
        "This GitHub issue cannot be dismissed.",
      );
    }

    await this.projectService.getById(actor, external.projectId);

    if (
      !(await this.projectService.canWriteProject(actor, external.projectId))
    ) {
      throw new ProjectManagementDeniedError();
    }

    await this.gitHubRepository.dismissExternalIssue(external.id);
  }

  /**
   * Assigns a pull request to a task or clears its assignment.
   *
   * @param actor - User assigning the pull request; must hold write permission.
   * @param pullRequestId - Stored pull request to assign.
   * @param workItemId - Task receiving the reference, or `null` to clear it.
   */
  public async assignPullRequest(
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

    await this.projectService.getById(actor, pullRequest.projectId);

    if (
      !(await this.projectService.canWriteProject(actor, pullRequest.projectId))
    ) {
      throw new ProjectManagementDeniedError();
    }

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

  /**
   * Resolves a synchronization conflict in favor of one side.
   *
   * @param actor - User resolving the conflict; must hold write permission.
   * @param workItemId - Task carrying the conflict flag.
   * @param resolution - Side whose values win the conflict.
   */
  public async resolveConflict(
    actor: User,
    workItemId: string,
    resolution: "pages" | "github",
  ): Promise<WorkItemDetail> {
    const item = await this.taskService.getById(actor, workItemId);

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new ProjectManagementDeniedError();
    }

    if (!item.githubConflict || item.githubIssueNumber === null) {
      throw new WorkItemValidationError("This task has no sync conflict.");
    }

    const sync = await this.loadSyncContext(item.projectId);

    if (!sync) {
      throw new Error("GitHub integration is not connected.");
    }

    const summary = this.emptySummary();

    if (resolution === "pages") {
      const remote = await sync.client.getIssue(
        sync.repo.owner,
        sync.repo.repo,
        item.githubIssueNumber,
      );

      await this.pushLocalState(
        sync,
        actor,
        item,
        item.githubIssueNumber,
        remote,
        summary,
      );
    } else {
      const remote = await sync.client.getIssue(
        sync.repo.owner,
        sync.repo.repo,
        item.githubIssueNumber,
      );
      const statuses = await this.taskRepository.findAllStatuses();

      await this.pullRemoteStateWithStatuses(
        actor,
        item,
        remote,
        statuses,
        summary,
      );
    }

    await this.taskRepository.setGitHubConflict(item.id, false);

    const resolved = await this.taskRepository.findById(item.id);

    if (!resolved) {
      throw new Error("Resolved task could not be retrieved.");
    }

    return resolved;
  }

  /**
   * Returns detected external issues after verifying project access.
   *
   * @param actor - User requesting the issues.
   * @param projectId - Project to inspect.
   */
  public async findExternalIssues(
    actor: User,
    projectId: string,
  ): Promise<GitHubExternalIssue[]> {
    await this.projectService.getById(actor, projectId);

    return this.gitHubRepository.findExternalIssues(projectId);
  }

  /**
   * Returns stored pull requests after verifying project access.
   *
   * @param actor - User requesting the pull requests.
   * @param projectId - Project to inspect.
   */
  public async findPullRequests(
    actor: User,
    projectId: string,
  ): Promise<GitHubPullRequest[]> {
    await this.projectService.getById(actor, projectId);

    return this.gitHubRepository.findPullRequestsByProject(projectId);
  }

  /**
   * Returns external issues for already access-checked projects.
   *
   * @remarks
   * Callers must only pass project ids the actor may access (the tasks
   * overview passes its already filtered project list).
   */
  public async findExternalIssuesByProjects(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly GitHubExternalIssue[]>> {
    const cacheKey = `github:issues:${stableIdKey(projectIds)}`;
    const cached =
      this.cache.get<ReadonlyMap<string, readonly GitHubExternalIssue[]>>(
        cacheKey,
      );

    if (cached) {
      return cached;
    }

    const issues =
      await this.gitHubRepository.findExternalIssuesByProjectIds(projectIds);
    this.cache.set(cacheKey, issues, CACHE_TTLS.github);

    return issues;
  }

  /**
   * Returns pull requests for already access-checked projects.
   *
   * @remarks
   * Callers must only pass project ids the actor may access (the tasks
   * overview passes its already filtered project list).
   */
  public async findPullRequestsByProjects(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly GitHubPullRequest[]>> {
    const cacheKey = `github:pull-requests:${stableIdKey(projectIds)}`;
    const cached =
      this.cache.get<ReadonlyMap<string, readonly GitHubPullRequest[]>>(
        cacheKey,
      );

    if (cached) {
      return cached;
    }

    const pullRequests =
      await this.gitHubRepository.findPullRequestsByProjectIds(projectIds);
    this.cache.set(cacheKey, pullRequests, CACHE_TTLS.github);

    return pullRequests;
  }

  /**
   * Returns pull requests assigned to one task after verifying access.
   *
   * @param actor - User requesting the pull requests.
   * @param workItemId - Task to inspect.
   */
  public async findPullRequestsForTask(
    actor: User,
    workItemId: string,
  ): Promise<GitHubPullRequest[]> {
    await this.taskService.getById(actor, workItemId);

    return this.gitHubRepository.findPullRequestsByWorkItem(workItemId);
  }

  /**
   * Verifies the stored connection against the GitHub API.
   *
   * @param actor - User testing the connection; must hold write permission.
   * @param projectId - Project to verify.
   * @returns Whether GitHub accepted the stored token and address.
   */
  public async testConnection(
    actor: User,
    projectId: string,
  ): Promise<boolean> {
    await this.projectService.getById(actor, projectId);

    if (!(await this.projectService.canWriteProject(actor, projectId))) {
      throw new ProjectManagementDeniedError();
    }

    const sync = await this.loadSyncContext(projectId, {
      allowTokenless: true,
    });

    if (!sync) {
      return false;
    }

    try {
      const repositoryName = await sync.client.getRepository(
        sync.repo.owner,
        sync.repo.repo,
      );

      await this.persistConnectionResult(sync.integration, projectId, {
        isConnected: true,
        repoName: repositoryName,
      });

      return true;
    } catch {
      await this.persistConnectionResult(sync.integration, projectId, {
        isConnected: false,
        repoName: sync.integration.repoName,
      });

      return false;
    }
  }

  private emptySummary(): GitHubSyncCounters {
    return {
      conflicts: 0,
      created: 0,
      detected: 0,
      pulled: 0,
      pullRequests: 0,
      pushed: 0,
    };
  }

  private canPush(integration: ProjectIntegration): boolean {
    return integration.syncDirection !== "pull";
  }

  private canPull(integration: ProjectIntegration): boolean {
    return integration.syncDirection !== "push";
  }

  private async persistConnectionResult(
    integration: ProjectIntegration,
    projectId: string,
    result: { readonly isConnected: boolean; readonly repoName: string | null },
  ): Promise<void> {
    await this.projectRepository.upsertIntegration(projectId, {
      isConnected: result.isConnected,
      lastSyncAt: integration.lastSyncAt,
      repoName: result.repoName,
      repoUrl: integration.repoUrl,
      syncComments: integration.syncComments,
      syncCommits: integration.syncCommits,
      syncDirection: integration.syncDirection,
      syncIntervalMinutes: integration.syncIntervalMinutes,
      syncIssues: integration.syncIssues,
      syncPullRequests: integration.syncPullRequests,
      syncStatus: integration.syncStatus,
      tokenEncrypted: null,
      tokenHash: null,
    });
  }

  private async loadSyncContext(
    projectId: string,
    options: { readonly allowTokenless?: boolean } = {},
  ): Promise<GitHubSyncContext | null> {
    const integration = await this.projectRepository.findIntegration(projectId);

    if (!integration || !integration.repoUrl) {
      return null;
    }

    const repo = parseGitHubRepository(integration.repoUrl);

    if (!repo) {
      return null;
    }

    const encrypted =
      await this.projectRepository.findTokenEncrypted(projectId);

    if (!encrypted) {
      return options.allowTokenless
        ? { client: this.createClient(""), integration, repo }
        : null;
    }

    return {
      client: this.createClient(decryptGitHubToken(encrypted, this.tokenKey)),
      integration,
      repo,
    };
  }

  private async runProjectSync(
    actor: User,
    projectId: string,
  ): Promise<GitHubSyncSummary> {
    const sync = await this.loadSyncContext(projectId);

    if (!sync) {
      throw new Error("GitHub integration is not connected.");
    }

    const summary = this.emptySummary();
    const timestamp = this.now();
    const tasks = await this.taskRepository.findAll({
      projectIds: [projectId],
      type: WORK_ITEM_TYPE.TASK,
    });
    const statuses = await this.taskRepository.findAllStatuses();
    const remoteIssues = sync.integration.syncIssues
      ? await sync.client.listIssues(sync.repo.owner, sync.repo.repo, "all")
      : [];
    const remoteByNumber = new Map(
      remoteIssues.map((issue) => [issue.number, issue]),
    );

    for (const item of tasks) {
      if (item.githubIssueNumber === null) {
        // Only operational tasks become issues; initiatives and epics
        // structure the work and never sync automatically.
        if (
          item.type === WORK_ITEM_TYPE.TASK &&
          sync.integration.syncIssues &&
          this.canPush(sync.integration)
        ) {
          await this.createRemoteIssue(sync, actor, item, summary);
        }

        continue;
      }

      if (item.githubConflict) {
        continue;
      }

      const remote = remoteByNumber.get(item.githubIssueNumber);

      if (!remote) {
        continue;
      }

      await this.reconcileLinkedItemWithRemote(
        sync,
        actor,
        item,
        item.githubIssueNumber,
        remote,
        statuses,
        summary,
      );
    }

    if (sync.integration.syncIssues) {
      await this.detectExternalIssues(sync, projectId, remoteByNumber, summary);
    }

    if (sync.integration.syncPullRequests) {
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

    const interval = sync.integration.syncIntervalMinutes;
    await this.projectRepository.updateSyncSchedule(projectId, {
      lastSyncAt: timestamp,
      nextSyncAt:
        interval > 0
          ? new Date(Date.parse(timestamp) + interval * 60_000).toISOString()
          : null,
    });

    return summary;
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
    const statuses = await this.taskRepository.findAllStatuses();

    await this.reconcileLinkedItemWithRemote(
      sync,
      actor,
      item,
      item.githubIssueNumber,
      remote,
      statuses,
      summary,
    );
  }

  private async reconcileLinkedItemWithRemote(
    sync: GitHubSyncContext,
    actor: User,
    item: WorkItemDetail,
    issueNumber: number,
    remote: GitHubIssueData,
    statuses: readonly WorkflowStatus[],
    summary: GitHubSyncCounters,
  ): Promise<void> {
    const localHash = computeGitHubContentHash(
      item.title,
      item.description,
      item.isDone,
    );
    const remoteHash = computeGitHubContentHash(
      remote.title,
      remote.body,
      remote.state === "closed",
    );
    const storedHash = item.githubContentHash;
    const pagesChanged = storedHash === null || localHash !== storedHash;
    const remoteChanged = storedHash !== null && remoteHash !== storedHash;

    if (!pagesChanged && !remoteChanged) {
      return;
    }

    if (pagesChanged && remoteChanged) {
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
      return;
    }

    if (pagesChanged && this.canPush(sync.integration)) {
      await this.pushLocalState(
        sync,
        actor,
        item,
        issueNumber,
        remote,
        summary,
      );
      return;
    }

    if (remoteChanged && this.canPull(sync.integration)) {
      await this.pullRemoteStateWithStatuses(
        actor,
        item,
        remote,
        statuses,
        summary,
      );
    }
  }

  private async pushLocalState(
    sync: GitHubSyncContext,
    actor: User,
    item: WorkItemDetail,
    issueNumber: number,
    remote: GitHubIssueData,
    summary: GitHubSyncCounters,
  ): Promise<void> {
    const patch: GitHubIssuePatch = {};

    if (item.title !== remote.title) {
      patch.title = item.title;
    }

    if (item.description !== remote.body) {
      patch.body = item.description;
    }

    const nextState = mapPagesToGitHubState(item.isDone);

    if (nextState !== remote.state) {
      patch.state = nextState;
    }

    if (
      patch.title === undefined &&
      patch.body === undefined &&
      patch.state === undefined
    ) {
      await this.refreshLinkBaseline(item, issueNumber, remote);
      return;
    }

    const updated = await sync.client.updateIssue(
      sync.repo.owner,
      sync.repo.repo,
      issueNumber,
      patch,
    );
    const timestamp = this.now();

    await this.taskRepository.updateGitHubLink(item.id, {
      conflict: false,
      contentHash: computeGitHubContentHash(
        item.title,
        item.description,
        item.isDone,
      ),
      issueNumber: updated.number,
      issueState: updated.state,
      issueUpdatedAt: updated.updatedAt,
      issueUrl: updated.url,
      lastSyncAt: timestamp,
    });
    await this.taskRepository.insertHistory({
      action: "github_sync",
      field: "github",
      id: randomUUID(),
      newValue: `#${updated.number}`,
      oldValue: null,
      userId: actor.id,
      workItemId: item.id,
    });
    summary.pushed += 1;
  }

  private async refreshLinkBaseline(
    item: WorkItemDetail,
    issueNumber: number,
    remote: GitHubIssueData,
  ): Promise<void> {
    await this.taskRepository.updateGitHubLink(item.id, {
      conflict: false,
      contentHash: computeGitHubContentHash(
        item.title,
        item.description,
        item.isDone,
      ),
      issueNumber,
      issueState: remote.state,
      issueUpdatedAt: remote.updatedAt,
      issueUrl: item.githubIssueUrl,
      lastSyncAt: this.now(),
    });
  }

  private async pullRemoteStateWithStatuses(
    actor: User,
    item: WorkItemDetail,
    remote: GitHubIssueData,
    statuses: readonly WorkflowStatus[],
    summary: GitHubSyncCounters,
  ): Promise<void> {
    const doneStatus = statuses.find((status) => status.isDone);
    const openStatus =
      statuses.find((status) => status.key === "backlog") ??
      statuses.find((status) => !status.isDone);

    let statusId = item.statusId;

    if (remote.state === "closed" && doneStatus && !item.isDone) {
      statusId = doneStatus.id;
    }

    // GitHub cannot distinguish Pages-specific open states, so an open
    // remote issue only moves the task out of a done status.
    if (remote.state === "open" && item.isDone && openStatus) {
      statusId = openStatus.id;
    }

    const timestamp = this.now();

    await this.taskRepository.update(item.id, {
      assigneeId: item.assigneeId,
      description: remote.body,
      dueAt: item.dueAt,
      milestoneId: item.milestoneId,
      parentId: item.parentId,
      priority: item.priority,
      reporterId: item.createdBy,
      startAt: item.startAt,
      statusId,
      title: remote.title,
    });
    await this.taskRepository.insertHistory({
      action: "github_sync",
      field: "github",
      id: randomUUID(),
      newValue: `#${remote.number}`,
      oldValue: null,
      userId: actor.id,
      workItemId: item.id,
    });
    await this.taskRepository.updateGitHubLink(item.id, {
      conflict: false,
      contentHash: computeGitHubContentHash(
        remote.title,
        remote.body,
        remote.state === "closed",
      ),
      issueNumber: remote.number,
      issueState: remote.state,
      issueUpdatedAt: remote.updatedAt,
      issueUrl: remote.url,
      lastSyncAt: timestamp,
    });
    summary.pulled += 1;
  }

  private async createRemoteIssue(
    sync: GitHubSyncContext,
    actor: User,
    item: WorkItemDetail,
    summary: GitHubSyncCounters,
  ): Promise<void> {
    const created = await sync.client.createIssue(
      sync.repo.owner,
      sync.repo.repo,
      { title: item.title, body: item.description },
    );

    if (item.isDone && created.state === "open") {
      await sync.client.updateIssue(
        sync.repo.owner,
        sync.repo.repo,
        created.number,
        { state: "closed" },
      );
    }

    const timestamp = this.now();
    const remoteState =
      item.isDone || created.state === "closed" ? "closed" : "open";

    await this.taskRepository.updateGitHubLink(item.id, {
      conflict: false,
      contentHash: computeGitHubContentHash(
        item.title,
        item.description,
        item.isDone,
      ),
      issueNumber: created.number,
      issueState: remoteState,
      issueUpdatedAt: created.updatedAt,
      issueUrl: created.url,
      lastSyncAt: timestamp,
    });
    await this.taskRepository.insertHistory({
      action: "github_sync",
      field: "github",
      id: randomUUID(),
      newValue: `#${created.number}`,
      oldValue: null,
      userId: actor.id,
      workItemId: item.id,
    });
    summary.created += 1;
  }

  private async detectExternalIssues(
    sync: GitHubSyncContext,
    projectId: string,
    remoteByNumber: ReadonlyMap<number, GitHubIssueData>,
    summary: GitHubSyncCounters,
  ): Promise<void> {
    const linkedNumbers = new Set(
      (await this.taskRepository.findLinkedWorkItems(projectId)).flatMap(
        (item) =>
          item.githubIssueNumber === null ? [] : [item.githubIssueNumber],
      ),
    );

    for (const remote of remoteByNumber.values()) {
      if (linkedNumbers.has(remote.number)) {
        continue;
      }

      const existing = await this.gitHubRepository.findExternalIssueByNumber(
        projectId,
        remote.number,
      );

      if (existing?.dismissed || existing?.importedWorkItemId) {
        continue;
      }

      if (existing) {
        await this.gitHubRepository.updateExternalIssue(existing.id, {
          state: remote.state,
          title: remote.title,
          url: remote.url,
        });
        continue;
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
}
