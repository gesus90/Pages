import {
  CACHE_TTLS,
  ServerCache,
  stableIdKey,
} from "@/backend/cache/ServerCache";
import { GitHubApiClient } from "@/backend/github/GitHubApiClient";
import { GitHubConflictResolver } from "@/backend/service/github/GitHubConflictResolver";
import { GitHubConnectionTester } from "@/backend/service/github/GitHubConnectionTester";
import { GitHubExternalIssueDetector } from "@/backend/service/github/GitHubExternalIssueDetector";
import { GitHubExternalIssueTriage } from "@/backend/service/github/GitHubExternalIssueTriage";
import { GitHubIssuePuller } from "@/backend/service/github/GitHubIssuePuller";
import { GitHubIssuePusher } from "@/backend/service/github/GitHubIssuePusher";
import { GitHubPullRequestService } from "@/backend/service/github/GitHubPullRequestService";
import { GitHubSyncAccessGuard } from "@/backend/service/github/GitHubSyncAccessGuard";
import { GitHubSyncContextLoader } from "@/backend/service/github/GitHubSyncContextLoader";
import { GitHubSyncRunner } from "@/backend/service/github/GitHubSyncRunner";

import type { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { ScheduledSyncResult } from "@/backend/service/github/GitHubSyncRunner";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type {
  GitHubExternalIssue,
  GitHubPullRequest,
  GitHubSyncSummary,
} from "@/definition/GitHub";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

export {
  computeGitHubContentHash,
  mapPagesToGitHubState,
} from "@/backend/service/github/GitHubIssueMapping";
export { parseGitHubRepository } from "@/backend/service/github/GitHubSyncContextLoader";

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

/**
 * Establishes the business-logic boundary for GitHub synchronization.
 *
 * @remarks
 * A facade over the collaborators in `./github/`; it forwards requests and
 * holds no synchronization logic of its own.
 */
export class GitHubSyncService {
  private readonly projectService: ProjectService;
  private readonly taskService: TaskService;
  private readonly gitHubRepository: GitHubRepository;
  private readonly cache: ServerCache;
  private readonly accessGuard: GitHubSyncAccessGuard;
  private readonly pusher: GitHubIssuePusher;
  private readonly conflictResolver: GitHubConflictResolver;
  private readonly externalIssueTriage: GitHubExternalIssueTriage;
  private readonly pullRequestService: GitHubPullRequestService;
  private readonly connectionTester: GitHubConnectionTester;
  private readonly runner: GitHubSyncRunner;

  /**
   * Creates a GitHub synchronization service.
   *
   * @param options - Repository, service, and infrastructure dependencies.
   */
  public constructor(options: GitHubSyncServiceOptions) {
    const now = options.now ?? currentGitHubSyncTime;
    const contextLoader = new GitHubSyncContextLoader(
      options.projectRepository,
      options.createClient ?? createGitHubApiClient,
      options.tokenKey,
    );
    const accessGuard = new GitHubSyncAccessGuard(
      options.projectService,
      options.taskService,
    );
    const pusher = new GitHubIssuePusher(
      options.taskRepository,
      contextLoader,
      now,
    );
    const puller = new GitHubIssuePuller(options.taskRepository, now);
    const conflictResolver = new GitHubConflictResolver({
      accessGuard,
      contextLoader,
      projectRepository: options.projectRepository,
      puller,
      pusher,
      taskRepository: options.taskRepository,
    });
    const pullRequestService = new GitHubPullRequestService(
      options.gitHubRepository,
      accessGuard,
      options.taskService,
    );

    this.projectService = options.projectService;
    this.taskService = options.taskService;
    this.gitHubRepository = options.gitHubRepository;
    this.cache = options.cache ?? ServerCache.disabled();
    this.accessGuard = accessGuard;
    this.pusher = pusher;
    this.conflictResolver = conflictResolver;
    this.pullRequestService = pullRequestService;
    this.externalIssueTriage = new GitHubExternalIssueTriage({
      accessGuard,
      contextLoader,
      gitHubRepository: options.gitHubRepository,
      now,
      taskRepository: options.taskRepository,
      taskService: options.taskService,
    });
    this.connectionTester = new GitHubConnectionTester(
      options.projectRepository,
      accessGuard,
      contextLoader,
    );
    this.runner = new GitHubSyncRunner({
      accessGuard,
      conflictResolver,
      contextLoader,
      externalIssueDetector: new GitHubExternalIssueDetector(
        options.taskRepository,
        options.gitHubRepository,
      ),
      now,
      projectRepository: options.projectRepository,
      pullRequestService,
      pusher,
      taskRepository: options.taskRepository,
      userRepository: options.userRepository,
    });
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
    await this.accessGuard.requireWritableProject(actor, projectId);

    return this.runner.runProject(actor, projectId);
  }

  /**
   * Synchronizes every project whose scheduled run is due.
   *
   * @returns Completed and failed run counters; failures never abort the batch.
   */
  public async runScheduledSyncs(): Promise<ScheduledSyncResult> {
    return this.runner.runDue();
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
    return this.runner.runSingleTask(actor, workItemId);
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
    return this.pusher.publishTaskUpdate(actor, item);
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
    return this.externalIssueTriage.importIssue(actor, projectId, issueNumber);
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
    return this.externalIssueTriage.linkIssue(actor, workItemId, externalId);
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
    return this.externalIssueTriage.dismissIssue(actor, externalId);
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
    return this.pullRequestService.assign(actor, pullRequestId, workItemId);
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
    return this.conflictResolver.resolve(actor, workItemId, resolution);
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
    return this.connectionTester.testConnection(actor, projectId);
  }
}
