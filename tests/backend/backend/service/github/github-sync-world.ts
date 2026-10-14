import { vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { GitHubApiClient } from "@/backend/github/GitHubApiClient";
import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import {
  computeGitHubContentHash,
  GitHubSyncService,
} from "@/backend/service/GitHubSyncService";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import { TaskLifecycleService } from "@/backend/service/task/TaskLifecycleService";

import {
  archiveProject,
  archiveTicket,
  archiveUser,
} from "../agents/archive-records";

import type { NewProjectActivity } from "@/backend/database/repositories/ProjectRepository";
import type { NewWorkItemHistory } from "@/backend/database/repositories/TaskRepository";
import type { GitHubApiResponse } from "@/backend/github/GitHubApiClient";
import type { GitHubSyncSummary } from "@/definition/GitHub";
import type { ProjectIntegration } from "@/definition/Project";
import type {
  ChildHandling,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";

const PROJECT_ID = "pages";
const REPOSITORY_PATH = "/repos/synthetic/pages";
const TOKEN = "synthetic-token";
const TOKEN_KEY = Buffer.alloc(32, 7);

/** The workflow statuses every project of the world offers. */
export const STATUSES: Readonly<
  Record<"backlog" | "todo" | "done", WorkflowStatus>
> = {
  backlog: {
    id: "status-backlog",
    isDone: false,
    key: "backlog",
    name: "Backlog",
    position: 1,
    projectId: null,
  },
  todo: {
    id: "status-todo",
    isDone: false,
    key: "todo",
    name: "To Do",
    position: 2,
    projectId: null,
  },
  done: {
    id: "status-done",
    isDone: true,
    key: "done",
    name: "Done",
    position: 3,
    projectId: null,
  },
};

/** One issue as the synthetic GitHub holds it. */
export interface RemoteIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  updatedAt: string;
}

/** One request that changed GitHub, as the synthetic GitHub received it. */
export interface GitHubWrite {
  readonly method: string;
  readonly number: number | null;
  readonly body: Readonly<Record<string, unknown>>;
}

/** The observable state of both sides and of the bookkeeping. */
export interface WorldSnapshot {
  readonly items: readonly WorkItemDetail[];
  readonly issues: readonly RemoteIssue[];
  readonly history: number;
  readonly activity: number;
}

function createStub<Instance extends object>(type: {
  readonly prototype: Instance;
}): Instance {
  return Object.create(type.prototype);
}

function respond(status: number, body: unknown): GitHubApiResponse {
  return { json: async () => body, ok: status < 400, status };
}

function readBody(raw: string | undefined): Record<string, unknown> {
  const parsed: unknown = raw === undefined ? {} : JSON.parse(raw);

  return typeof parsed === "object" && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

function toIssueJson(issue: RemoteIssue): Record<string, unknown> {
  return {
    body: issue.body,
    html_url: `https://github.com/synthetic/pages/issues/${issue.number}`,
    number: issue.number,
    state: issue.state,
    title: issue.title,
    updated_at: issue.updatedAt,
  };
}

function createIntegration(): ProjectIntegration {
  return {
    hasToken: true,
    isConnected: true,
    lastSyncAt: null,
    nextSyncAt: null,
    projectId: PROJECT_ID,
    repoName: "synthetic/pages",
    repoUrl: "https://github.com/synthetic/pages",
    syncComments: false,
    syncCommits: false,
    syncDirection: "bidirectional",
    syncEnabled: true,
    syncIntervalMinutes: 15,
    syncIssues: true,
    syncPullRequests: false,
    syncStatus: true,
    updatedAt: "2026-10-14 00:00:00",
  };
}

function withStatus(
  item: WorkItemDetail,
  status: WorkflowStatus,
): WorkItemDetail {
  return {
    ...item,
    isDone: status.isDone,
    statusId: status.id,
    statusKey: status.key,
    statusName: status.name,
  };
}

/**
 * The real GitHub synchronization and ticket lifecycle services around
 * in-memory stand-ins for the repositories and an in-memory GitHub REST
 * transport. No database, network or service factory is opened.
 */
export class GitHubSyncWorld {
  public readonly items = new Map<string, WorkItemDetail>();
  public readonly remote = new Map<number, RemoteIssue>();
  public readonly requests: string[] = [];
  public readonly writes: GitHubWrite[] = [];
  public readonly history: NewWorkItemHistory[] = [];
  public readonly activity: NewProjectActivity[] = [];
  public readonly service: GitHubSyncService;
  public integration: ProjectIntegration = createIntegration();
  public canWrite = true;
  private readonly lifecycle: TaskLifecycleService;
  private readonly actor = archiveUser("owner", {});
  private clock = 0;
  private nextIssueNumber = 100;

  public constructor() {
    const taskRepository = this.createTaskRepository();
    const userRepository = createStub(UserRepository);

    vi.spyOn(userRepository, "findById").mockImplementation(
      async () => this.actor,
    );
    this.lifecycle = this.createLifecycle(taskRepository);
    this.service = new GitHubSyncService({
      cache: ServerCache.disabled(),
      createClient: (token) =>
        new GitHubApiClient(token, async (url, options) =>
          this.handleRequest(url, options),
        ),
      gitHubRepository: createStub(GitHubRepository),
      now: () => this.stamp(),
      projectRepository: this.createProjectRepository(),
      projectService: this.createProjectService(),
      taskRepository,
      taskService: this.createTaskService(),
      tokenKey: TOKEN_KEY,
      userRepository,
    });
  }

  /** Changes the GitHub integration settings of the project. */
  public configure(changes: Partial<ProjectIntegration>): void {
    this.integration = { ...this.integration, ...changes };
  }

  /** Adds an active task whose issue is open and whose link baseline is in sync. */
  public addLinkedTask(
    id: string,
    issueNumber: number,
    overrides: Partial<WorkItemDetail> = {},
  ): void {
    const item = this.createTicket(id, overrides);
    const updatedAt = this.stamp();

    this.remote.set(issueNumber, {
      body: item.description,
      number: issueNumber,
      state: "open",
      title: item.title,
      updatedAt,
    });
    this.items.set(id, {
      ...item,
      githubContentHash: computeGitHubContentHash(
        item.title,
        item.description,
        false,
      ),
      githubIssueNumber: issueNumber,
      githubIssueState: "open",
      githubIssueUpdatedAt: updatedAt,
      githubIssueUrl: `https://github.com/synthetic/pages/issues/${issueNumber}`,
      githubLastSyncAt: updatedAt,
    });
  }

  /** Adds an active task that has no issue yet. */
  public addUnlinkedTask(
    id: string,
    overrides: Partial<WorkItemDetail> = {},
  ): void {
    this.items.set(id, this.createTicket(id, overrides));
  }

  /** Moves a task to a workflow status the way a Pages edit does. */
  public setStatus(id: string, status: WorkflowStatus): void {
    this.items.set(id, withStatus(this.item(id), status));
  }

  /** Changes the title or description of a task in Pages only. */
  public editInPages(
    id: string,
    changes: Partial<Pick<WorkItemDetail, "title" | "description">>,
  ): void {
    this.items.set(id, { ...this.item(id), ...changes });
  }

  /** Changes the title or body of an issue on GitHub only. */
  public editOnGitHub(
    issueNumber: number,
    changes: Partial<Pick<RemoteIssue, "title" | "body">>,
  ): void {
    this.remoteIssue(issueNumber, changes);
  }

  /** Closes an issue on GitHub only. */
  public closeOnGitHub(issueNumber: number): void {
    this.remoteIssue(issueNumber, { state: "closed" });
  }

  /** Reopens an issue on GitHub only. */
  public reopenOnGitHub(issueNumber: number): void {
    this.remoteIssue(issueNumber, { state: "open" });
  }

  /** Archives a task through the real lifecycle service. */
  public async archive(
    id: string,
    handling: ChildHandling = "include",
  ): Promise<number> {
    return this.lifecycle.archive(this.actor, id, handling);
  }

  /** Restores a task through the real lifecycle service. */
  public async restore(id: string): Promise<void> {
    await this.lifecycle.restore(this.actor, id);
  }

  /** Runs the manual synchronization of the project. */
  public async syncProject(): Promise<GitHubSyncSummary> {
    return this.service.syncProjectNow(this.actor, PROJECT_ID);
  }

  /** Runs the scheduled synchronization of every due project. */
  public async syncDue(): Promise<{ completed: number; failed: number }> {
    const result = await this.service.runScheduledSyncs();

    return { completed: result.completed, failed: result.failed };
  }

  /** Runs the synchronization of one linked task. */
  public async syncTask(id: string): Promise<GitHubSyncSummary> {
    return this.service.syncSingleTask(this.actor, id);
  }

  /** Pushes one task the way the best-effort publication after an edit does. */
  public async publish(id: string): Promise<void> {
    await this.service.publishTaskUpdate(this.actor, this.item(id));
  }

  /** Returns a task of the world. */
  public item(id: string): WorkItemDetail {
    const item = this.items.get(id);

    if (!item) {
      throw new Error(`Unknown synthetic task ${id}`);
    }

    return item;
  }

  /** Returns an issue of the synthetic GitHub. */
  public issue(issueNumber: number): RemoteIssue {
    const issue = this.remote.get(issueNumber);

    if (!issue) {
      throw new Error(`Unknown synthetic issue ${issueNumber}`);
    }

    return issue;
  }

  /** Copies the observable state so a later run can be compared with it. */
  public snapshot(): WorldSnapshot {
    return structuredClone({
      activity: this.activity.length,
      history: this.history.length,
      issues: [...this.remote.values()],
      items: [...this.items.values()],
    });
  }

  private handleRequest(
    url: string,
    options: {
      readonly method: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body?: string;
    },
  ): GitHubApiResponse {
    const { pathname } = new URL(url);

    this.requests.push(`${options.method} ${pathname}`);

    if (options.headers.Authorization !== `Bearer ${TOKEN}`) {
      return respond(401, { message: "Bad credentials" });
    }

    const issueMatch = /^\/repos\/synthetic\/pages\/issues\/(\d+)$/.exec(
      pathname,
    );
    const issueNumber = issueMatch?.[1] ? Number(issueMatch[1]) : null;

    if (options.method === "GET" && pathname === `${REPOSITORY_PATH}/issues`) {
      return respond(
        200,
        [...this.remote.values()].map((issue) => toIssueJson(issue)),
      );
    }

    return this.handleIssueRequest(options, pathname, issueNumber);
  }

  private handleIssueRequest(
    options: { readonly method: string; readonly body?: string },
    pathname: string,
    issueNumber: number | null,
  ): GitHubApiResponse {
    const body = readBody(options.body);

    if (options.method === "POST" && pathname === `${REPOSITORY_PATH}/issues`) {
      this.writes.push({ body, method: "POST", number: null });
      this.nextIssueNumber += 1;
      const created: RemoteIssue = {
        body: typeof body.body === "string" ? body.body : "",
        number: this.nextIssueNumber,
        state: "open",
        title: typeof body.title === "string" ? body.title : "",
        updatedAt: this.stamp(),
      };
      this.remote.set(created.number, created);

      return respond(201, toIssueJson(created));
    }

    const issue =
      issueNumber === null ? undefined : this.remote.get(issueNumber);

    if (!issue) {
      return respond(404, { message: "Not Found" });
    }

    if (options.method === "PATCH") {
      this.writes.push({ body, method: "PATCH", number: issue.number });
      issue.title = typeof body.title === "string" ? body.title : issue.title;
      issue.body = typeof body.body === "string" ? body.body : issue.body;
      issue.state =
        body.state === "open" || body.state === "closed"
          ? body.state
          : issue.state;
      issue.updatedAt = this.stamp();
    }

    return respond(200, toIssueJson(issue));
  }

  private remoteIssue(
    issueNumber: number,
    changes: Partial<Omit<RemoteIssue, "number" | "updatedAt">>,
  ): void {
    Object.assign(this.issue(issueNumber), changes, {
      updatedAt: this.stamp(),
    });
  }

  private stamp(): string {
    this.clock += 1;

    return new Date(Date.UTC(2026, 9, 14, 12, 0, this.clock)).toISOString();
  }

  private createTicket(
    id: string,
    overrides: Partial<WorkItemDetail>,
  ): WorkItemDetail {
    return withStatus(
      archiveTicket(id, {
        departmentId: null,
        key: `PAGE-${id}`,
        milestoneId: null,
        milestoneName: null,
        projectId: PROJECT_ID,
        projectName: "Pages",
        title: `Task ${id}`,
        ...overrides,
      }),
      STATUSES.todo,
    );
  }

  private subtreeIds(rootId: string): string[] {
    const ids = new Set([rootId]);
    let size = 0;

    while (size !== ids.size) {
      size = ids.size;

      for (const item of this.items.values()) {
        if (item.parentId !== null && ids.has(item.parentId)) {
          ids.add(item.id);
        }
      }
    }

    return [...ids];
  }

  private createTaskRepository(): TaskRepository {
    const repository = createStub(TaskRepository);

    this.stubTaskReads(repository);
    this.stubTaskWrites(repository);
    this.stubTaskLifecycle(repository);

    return repository;
  }

  private stubTaskReads(repository: TaskRepository): void {
    vi.spyOn(repository, "findAll").mockImplementation(async (options = {}) =>
      [...this.items.values()].filter(
        (item) =>
          item.archivedAt === null &&
          (options.projectIds?.includes(item.projectId) ?? true) &&
          (options.type === undefined || item.type === options.type),
      ),
    );
    vi.spyOn(repository, "findArchivedLinkedWorkItems").mockImplementation(
      async (projectId) =>
        [...this.items.values()].filter(
          (item) =>
            item.projectId === projectId &&
            item.type === "task" &&
            item.archivedAt !== null &&
            item.githubIssueNumber !== null,
        ),
    );
    vi.spyOn(repository, "findAllStatuses").mockImplementation(async () =>
      Object.values(STATUSES),
    );
    vi.spyOn(repository, "findById").mockImplementation(
      async (id) => this.items.get(id) ?? null,
    );
    vi.spyOn(repository, "findKnownGitHubIssueNumbers").mockImplementation(
      async () =>
        new Set(
          [...this.items.values()].flatMap((item) =>
            item.githubIssueNumber === null ? [] : [item.githubIssueNumber],
          ),
        ),
    );
  }

  private stubTaskWrites(repository: TaskRepository): void {
    vi.spyOn(repository, "updateGitHubLink").mockImplementation(
      async (id, link) => {
        this.items.set(id, {
          ...this.item(id),
          githubConflict: link.conflict,
          githubContentHash: link.contentHash,
          githubIssueNumber: link.issueNumber,
          githubIssueState: link.issueState,
          githubIssueUpdatedAt: link.issueUpdatedAt,
          githubIssueUrl: link.issueUrl,
          githubLastSyncAt: link.lastSyncAt,
        });
      },
    );
    vi.spyOn(repository, "updateFromGitHub").mockImplementation(
      async (id, update) => {
        const status = Object.values(STATUSES).find(
          (candidate) => candidate.id === update.statusId,
        );

        this.items.set(id, {
          ...withStatus(this.item(id), status ?? STATUSES.todo),
          description: update.description,
          title: update.title,
        });
      },
    );
    vi.spyOn(repository, "setGitHubConflict").mockImplementation(
      async (id, conflict) => {
        this.items.set(id, { ...this.item(id), githubConflict: conflict });
      },
    );
    vi.spyOn(repository, "insertHistory").mockImplementation(async (entry) => {
      this.history.push(entry);
    });
  }

  private stubTaskLifecycle(repository: TaskRepository): void {
    vi.spyOn(repository, "findSubtreeIds").mockImplementation(async (id) =>
      this.subtreeIds(id),
    );
    vi.spyOn(repository, "findParentReference").mockImplementation(
      async (id) => {
        const parentId = this.items.get(id)?.parentId ?? null;
        const parent = parentId === null ? undefined : this.items.get(parentId);

        return parent ? { id: parent.id, key: parent.key } : null;
      },
    );
    vi.spyOn(repository, "archiveMany").mockImplementation(async (ids) =>
      this.setArchived(ids, "2026-10-14 12:30:00"),
    );
    vi.spyOn(repository, "restoreMany").mockImplementation(async (ids) => {
      this.setArchived(ids, null);
    });
  }

  private setArchived(
    ids: readonly string[],
    archivedAt: string | null,
  ): string[] {
    const changed: string[] = [];

    for (const id of ids) {
      const item = this.items.get(id);

      if (item && (item.archivedAt === null) === (archivedAt !== null)) {
        this.items.set(id, { ...item, archivedAt });
        changed.push(id);
      }
    }

    return changed;
  }

  private createProjectRepository(): ProjectRepository {
    const repository = createStub(ProjectRepository);

    vi.spyOn(repository, "findIntegration").mockImplementation(
      async () => this.integration,
    );
    vi.spyOn(repository, "findTokenEncrypted").mockImplementation(async () =>
      encryptGitHubToken(TOKEN, TOKEN_KEY),
    );
    // The due list is deliberately independent of the switch: a stale entry
    // must still not lead to a write when the synchronization is off.
    vi.spyOn(repository, "findDueSyncIntegrations").mockImplementation(
      async () => [{ ownerId: this.actor.id, projectId: PROJECT_ID }],
    );
    vi.spyOn(repository, "updateSyncSchedule").mockResolvedValue();
    vi.spyOn(repository, "insertActivity").mockImplementation(async (entry) => {
      this.activity.push(entry);
    });

    return repository;
  }

  private createProjectService(): ProjectService {
    const service = createStub(ProjectService);

    vi.spyOn(service, "getById").mockImplementation(async () =>
      archiveProject(PROJECT_ID, []),
    );
    vi.spyOn(service, "canWriteProject").mockImplementation(
      async () => this.canWrite,
    );
    vi.spyOn(service, "workItemVisibility").mockResolvedValue({
      departmentIds: null,
    });

    return service;
  }

  private createTaskService(): TaskService {
    const service = createStub(TaskService);

    vi.spyOn(service, "getById").mockImplementation(async (actor, id) =>
      this.item(id),
    );

    return service;
  }

  private createLifecycle(repository: TaskRepository): TaskLifecycleService {
    const access = createStub(TaskAccessGuard);
    const recorder = createStub(TaskHistoryRecorder);
    const read = async (actor: unknown, id: string): Promise<WorkItemDetail> =>
      this.item(id);

    vi.spyOn(access, "requireArchivableWorkItem").mockImplementation(read);
    vi.spyOn(access, "requireWritableWorkItem").mockImplementation(read);
    vi.spyOn(access, "requireWorkItem").mockImplementation(read);
    vi.spyOn(access, "visibility").mockResolvedValue({ departmentIds: null });
    vi.spyOn(recorder, "recordArchived").mockResolvedValue();
    vi.spyOn(recorder, "recordRestored").mockResolvedValue();

    return new TaskLifecycleService(
      repository,
      access,
      recorder,
      ServerCache.disabled(),
    );
  }
}
