import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import {
  computeGitHubContentHash,
  createGitHubApiClient,
  currentGitHubSyncTime,
  GitHubSyncService,
  mapPagesToGitHubState,
  parseGitHubRepository,
} from "@/backend/service/GitHubSyncService";
import { GitHubApiClient } from "@/backend/github/GitHubApiClient";
import { ProjectManagementDeniedError } from "@/backend/service/ProjectService";
import { WorkItemValidationError } from "@/backend/service/TaskService";
import { ROLE } from "@/definition/Role";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import type { ProjectIntegration } from "@/definition/Project";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";

type MockMap = { [key: string]: ReturnType<typeof vi.fn> };

const NOW = "2026-09-05T14:21:00.000Z";

function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
    ...overrides,
  };
}

function createIntegration(
  overrides: Partial<ProjectIntegration> = {},
): ProjectIntegration {
  return {
    hasToken: true,
    isConnected: true,
    lastSyncAt: null,
    nextSyncAt: null,
    projectId: "project-1",
    repoName: "user/pages",
    repoUrl: "https://github.com/user/pages.git",
    syncComments: true,
    syncCommits: false,
    syncDirection: "bidirectional",
    syncIntervalMinutes: 15,
    syncIssues: true,
    syncPullRequests: true,
    syncStatus: true,
    updatedAt: "2026-09-05",
    ...overrides,
  };
}

function createWorkItem(
  overrides: Partial<WorkItemDetail> = {},
): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeId: null,
    assigneeName: null,
    reporterName: null,
    completedAt: null,
    createdAt: "2026-09-01",
    createdBy: "user-1",
    description: "Implement sync",
    dueAt: null,
    githubConflict: false,
    githubContentHash: computeGitHubContentHash(
      "GitHub Synchronisation implementieren",
      "Implement sync",
      false,
    ),
    githubIssueNumber: 82,
    githubIssueState: "open",
    githubIssueUpdatedAt: "2026-09-05T14:00:00.000Z",
    githubIssueUrl: "https://github.com/user/pages/issues/82",
    githubLastError: null,
    githubLastSyncAt: "2026-09-05T14:00:00.000Z",
    id: "item-1",
    isDone: false,
    key: "PAGE-42",
    milestoneId: null,
    milestoneName: null,
    number: 42,
    parentId: null,
    parentKey: null,
    parentTitle: null,
    priority: WORK_ITEM_PRIORITY.NORMAL,
    progressPercentage: 0,
    projectId: "project-1",
    projectName: "Pages",
    sortOrder: 1,
    startAt: null,
    statusId: "status-in-progress",
    statusKey: "in_progress",
    statusName: "In Arbeit",
    subtaskCompleted: 0,
    subtaskTotal: 0,
    title: "GitHub Synchronisation implementieren",
    type: WORK_ITEM_TYPE.TASK,
    updatedAt: "2026-09-05T14:00:00.000Z",
    ...overrides,
  };
}

function createStatuses(): WorkflowStatus[] {
  return [
    {
      id: "status-backlog",
      isDone: false,
      key: "backlog",
      name: "Backlog",
      position: 1,
      projectId: null,
    },
    {
      id: "status-done",
      isDone: true,
      key: "done",
      name: "Done",
      position: 5,
      projectId: null,
    },
  ];
}

function createRemoteIssue(overrides: Record<string, unknown> = {}) {
  return {
    body: "Implement sync",
    number: 82,
    state: "open",
    title: "GitHub Synchronisation implementieren",
    updatedAt: "2026-09-05T14:00:00.000Z",
    url: "https://github.com/user/pages/issues/82",
    ...overrides,
  };
}

function createClientStub() {
  return {
    createIssue: vi
      .fn()
      .mockImplementation(
        (owner: string, repo: string, input: { title: string; body: string }) =>
          Promise.resolve({
            ...createRemoteIssue({ body: input.body, title: input.title }),
            number: 99,
            url: `https://github.com/${owner}/${repo}/issues/99`,
          }),
      ),
    getIssue: vi.fn().mockResolvedValue(createRemoteIssue()),
    getRepository: vi.fn().mockResolvedValue("user/pages"),
    listIssues: vi.fn().mockResolvedValue([]),
    listPullRequests: vi.fn().mockResolvedValue([]),
    updateIssue: vi
      .fn()
      .mockImplementation(
        (owner: string, repo: string, issueNumber: number, patch: object) =>
          Promise.resolve({ ...createRemoteIssue(), ...patch }),
      ),
  };
}

const TOKEN_KEY = Buffer.alloc(32, 3);
const ENCRYPTED_TOKEN = encryptGitHubToken("ghp-test-token", TOKEN_KEY);

function createDependencies(cache?: ServerCache) {
  const taskRepository = {
    findAll: vi.fn().mockResolvedValue([]),
    findAllStatuses: vi.fn().mockResolvedValue(createStatuses()),
    findById: vi.fn(),
    findLinkedWorkItems: vi.fn().mockResolvedValue([]),
    insertHistory: vi.fn(),
    setGitHubConflict: vi.fn(),
    update: vi.fn(),
    updateGitHubLink: vi.fn(),
  } as unknown as MockMap;
  const projectRepository = {
    findDueSyncIntegrations: vi.fn().mockResolvedValue([]),
    findIntegration: vi.fn().mockResolvedValue(createIntegration()),
    findTokenEncrypted: vi.fn().mockResolvedValue(ENCRYPTED_TOKEN),
    insertActivity: vi.fn(),
    updateSyncSchedule: vi.fn(),
    upsertIntegration: vi.fn(),
  } as unknown as MockMap;
  const gitHubRepository = {
    assignPullRequest: vi.fn(),
    dismissExternalIssue: vi.fn(),
    findExternalIssueById: vi.fn(),
    findExternalIssueByNumber: vi.fn(),
    findExternalIssues: vi.fn().mockResolvedValue([]),
    findExternalIssuesByProjectIds: vi.fn().mockResolvedValue(new Map()),
    findPullRequestById: vi.fn(),
    findPullRequestsByProject: vi.fn().mockResolvedValue([]),
    findPullRequestsByProjectIds: vi.fn().mockResolvedValue(new Map()),
    findPullRequestsByWorkItem: vi.fn().mockResolvedValue([]),
    markExternalIssueImported: vi.fn(),
    updateExternalIssue: vi.fn(),
    upsertExternalIssue: vi.fn(),
    upsertPullRequest: vi.fn(),
  } as unknown as MockMap;
  const userRepository = {
    findById: vi.fn().mockResolvedValue(createUser()),
  } as unknown as MockMap;
  const projectService = {
    canWriteProject: vi.fn().mockResolvedValue(true),
    getById: vi.fn().mockImplementation((actor: unknown, projectId: string) =>
      Promise.resolve({
        createdAt: "2026-01-01",
        description: "",
        hasIcon: false,
        id: projectId,
        managerId: null,
        managerName: null,
        name: "Pages",
        notes: "",
        parentId: null,
        placeholderColor: "#FCE3D3",
        progress: 0,
        startDate: null,
        status: "active",
        targetDate: null,
        updatedAt: "2026-01-02",
      }),
    ),
  } as unknown as MockMap;
  const taskService = {
    create: vi
      .fn()
      .mockImplementation((actor: unknown, input: { title: string }) =>
        Promise.resolve(createWorkItem({ id: "item-new", title: input.title })),
      ),
    getById: vi.fn().mockResolvedValue(createWorkItem()),
    update: vi.fn(),
  } as unknown as MockMap;
  const client = createClientStub();
  const service = new GitHubSyncService({
    cache,
    createClient: () => client as unknown as GitHubApiClient,
    gitHubRepository: gitHubRepository as never,
    now: () => NOW,
    projectRepository: projectRepository as never,
    projectService: projectService as never,
    taskRepository: taskRepository as never,
    taskService: taskService as never,
    tokenKey: TOKEN_KEY,
    userRepository: userRepository as never,
  });

  return {
    client,
    gitHubRepository,
    projectRepository,
    projectService,
    service,
    taskRepository,
    taskService,
    userRepository,
  };
}

describe("GitHub repository parsing and mapping", () => {
  it("splits repository addresses into owner and name", () => {
    expect(parseGitHubRepository("https://github.com/user/pages.git")).toEqual({
      owner: "user",
      repo: "pages",
    });
    expect(parseGitHubRepository("https://github.com/user/pages")).toEqual({
      owner: "user",
      repo: "pages",
    });
    expect(parseGitHubRepository("https://gitlab.com/user/pages")).toBeNull();
    expect(parseGitHubRepository("not-a-url")).toBeNull();
  });

  it("hashes synchronized content deterministically", () => {
    const first = computeGitHubContentHash("Title", "Body", false);
    expect(computeGitHubContentHash("Title", "Body", false)).toBe(first);
    expect(computeGitHubContentHash("Title", "Body", true)).not.toBe(first);
    expect(computeGitHubContentHash("Other", "Body", false)).not.toBe(first);
  });

  it("maps Pages completion onto GitHub states", () => {
    expect(mapPagesToGitHubState(true)).toBe("closed");
    expect(mapPagesToGitHubState(false)).toBe("open");
  });
});

describe("GitHubSyncService defaults", () => {
  it("creates live clients and timestamps without injected infrastructure", async () => {
    expect(createGitHubApiClient("ghp-token")).toBeInstanceOf(GitHubApiClient);
    expect(Number.isNaN(Date.parse(currentGitHubSyncTime()))).toBe(false);

    const dependencies = createDependencies();
    const fetchStub = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchStub);

    try {
      const service = new GitHubSyncService({
        gitHubRepository: dependencies.gitHubRepository as never,
        projectRepository: dependencies.projectRepository as never,
        projectService: dependencies.projectService as never,
        taskRepository: dependencies.taskRepository as never,
        taskService: dependencies.taskService as never,
        tokenKey: TOKEN_KEY,
        userRepository: dependencies.userRepository as never,
      });

      dependencies.projectRepository.findTokenEncrypted.mockResolvedValue(
        encryptGitHubToken("ghp-live-token", TOKEN_KEY),
      );

      const summary = await service.syncProjectNow(createUser(), "project-1");

      expect(fetchStub).toHaveBeenCalledWith(
        expect.stringContaining("api.github.com"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp-live-token",
          }),
        }),
      );
      expect(summary).toMatchObject({ created: 0 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("GitHubSyncService project runs", () => {
  let dependencies: ReturnType<typeof createDependencies>;

  beforeEach(() => {
    dependencies = createDependencies();
  });

  it("denies runs without write permission", async () => {
    const { projectService, service } = dependencies;
    projectService.canWriteProject.mockResolvedValue(false);

    await expect(
      service.syncProjectNow(createUser(), "project-1"),
    ).rejects.toThrow(ProjectManagementDeniedError);
  });

  it("refuses runs without a connected integration", async () => {
    const { projectRepository, service } = dependencies;
    projectRepository.findIntegration.mockResolvedValue(null);

    await expect(
      service.syncProjectNow(createUser(), "project-1"),
    ).rejects.toThrow("not connected");
  });

  it("skips unchanged links without remote writes", async () => {
    const { client, service, taskRepository } = dependencies;
    const item = createWorkItem();
    taskRepository.findAll.mockResolvedValue([item]);
    client.listIssues.mockResolvedValue([createRemoteIssue()]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(summary).toMatchObject({ pushed: 0, pulled: 0, created: 0 });
    expect(client.updateIssue).not.toHaveBeenCalled();
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it("pushes local changes with minimal patches", async () => {
    const { client, service, taskRepository } = dependencies;
    const item = createWorkItem({ description: "Changed locally" });
    taskRepository.findAll.mockResolvedValue([item]);
    client.listIssues.mockResolvedValue([createRemoteIssue()]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(client.updateIssue).toHaveBeenCalledWith(
      "user",
      "pages",
      82,
      expect.objectContaining({ body: "Changed locally" }),
    );
    expect(summary.pushed).toBe(1);
    expect(taskRepository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ action: "github_sync" }),
    );
  });

  it("refreshes baselines when content already matches", async () => {
    const { client, service, taskRepository } = dependencies;
    const item = createWorkItem({ githubContentHash: null });
    taskRepository.findAll.mockResolvedValue([item]);
    client.listIssues.mockResolvedValue([createRemoteIssue()]);

    await service.syncProjectNow(createUser(), "project-1");

    expect(client.updateIssue).not.toHaveBeenCalled();
    expect(taskRepository.updateGitHubLink).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ issueNumber: 82 }),
    );
  });

  it("pulls closed remote issues into done statuses", async () => {
    const { client, service, taskRepository } = dependencies;
    const item = createWorkItem({
      githubContentHash: computeGitHubContentHash(
        "GitHub Synchronisation implementieren",
        "Implement sync",
        false,
      ),
    });
    taskRepository.findAll.mockResolvedValue([item]);
    client.listIssues.mockResolvedValue([
      createRemoteIssue({
        state: "closed",
        updatedAt: "2026-09-05T14:20:00.000Z",
      }),
    ]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(taskRepository.update).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ statusId: "status-done" }),
    );
    expect(summary.pulled).toBe(1);
  });

  it("keeps Pages-specific states when pulling remote changes", async () => {
    const { client, service, taskRepository } = dependencies;
    const item = createWorkItem({ statusId: "status-in-progress" });
    taskRepository.findAll.mockResolvedValue([item]);
    client.listIssues.mockResolvedValue([
      createRemoteIssue({
        body: "Changed remotely",
        updatedAt: "2026-09-05T14:20:00.000Z",
      }),
    ]);

    await service.syncProjectNow(createUser(), "project-1");

    expect(taskRepository.update).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({
        description: "Changed remotely",
        statusId: "status-in-progress",
      }),
    );
  });

  it("flags conflicts without overwriting either side", async () => {
    const { client, service, taskRepository } = dependencies;
    const item = createWorkItem({ description: "Changed locally" });
    taskRepository.findAll.mockResolvedValue([item]);
    client.listIssues.mockResolvedValue([
      createRemoteIssue({
        title: "Changed remotely",
        updatedAt: "2026-09-05T14:20:00.000Z",
      }),
    ]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(summary.conflicts).toBe(1);
    expect(taskRepository.setGitHubConflict).toHaveBeenCalledWith(
      "item-1",
      true,
    );
    expect(client.updateIssue).not.toHaveBeenCalled();
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it("skips conflicted items until manual resolution", async () => {
    const { client, service, taskRepository } = dependencies;
    taskRepository.findAll.mockResolvedValue([
      createWorkItem({ githubConflict: true }),
    ]);
    client.listIssues.mockResolvedValue([createRemoteIssue()]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(summary).toMatchObject({ conflicts: 0, pushed: 0, pulled: 0 });
    expect(client.updateIssue).not.toHaveBeenCalled();
  });

  it("creates remote issues for unlinked tasks only", async () => {
    const { client, service, taskRepository } = dependencies;
    taskRepository.findAll.mockResolvedValue([
      createWorkItem({
        id: "item-new",
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
        key: "PAGE-43",
      }),
      createWorkItem({
        id: "epic-1",
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
        key: "PAGE-1",
        type: WORK_ITEM_TYPE.EPIC,
      }),
    ]);
    client.listIssues.mockResolvedValue([]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(client.createIssue).toHaveBeenCalledTimes(1);
    expect(summary.created).toBe(1);
    expect(taskRepository.updateGitHubLink).toHaveBeenCalledWith(
      "item-new",
      expect.objectContaining({ issueNumber: 99 }),
    );
  });

  it("respects disabled issue synchronization and pull direction", async () => {
    const { client, projectRepository, service, taskRepository } = dependencies;
    projectRepository.findIntegration.mockResolvedValue(
      createIntegration({ syncDirection: "pull", syncIssues: false }),
    );
    taskRepository.findAll.mockResolvedValue([
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    ]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(client.createIssue).not.toHaveBeenCalled();
    expect(client.listIssues).not.toHaveBeenCalled();
    expect(summary.created).toBe(0);
  });

  it("detects external issues without touching linked ones", async () => {
    const { client, gitHubRepository, service, taskRepository } = dependencies;
    taskRepository.findAll.mockResolvedValue([]);
    taskRepository.findLinkedWorkItems.mockResolvedValue([
      createWorkItem(),
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
        id: "item-legacy",
      }),
    ]);
    client.listIssues.mockResolvedValue([
      createRemoteIssue(),
      createRemoteIssue({
        number: 104,
        title: "Mobile Navigation funktioniert nicht",
        url: "https://github.com/user/pages/issues/104",
      }),
    ]);
    gitHubRepository.findExternalIssueByNumber.mockResolvedValue(null);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(gitHubRepository.upsertExternalIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 104 }),
    );
    expect(summary.detected).toBe(1);
  });

  it("refreshes known external issues and skips triaged ones", async () => {
    const { client, gitHubRepository, service, taskRepository } = dependencies;
    taskRepository.findAll.mockResolvedValue([]);
    client.listIssues.mockResolvedValue([
      createRemoteIssue({
        number: 104,
        title: "Updated title",
        url: "https://github.com/user/pages/issues/104",
      }),
      createRemoteIssue({
        number: 105,
        title: "Dismissed",
        url: "https://github.com/user/pages/issues/105",
      }),
      createRemoteIssue({
        number: 106,
        title: "Imported",
        url: "https://github.com/user/pages/issues/106",
      }),
    ]);
    gitHubRepository.findExternalIssueByNumber.mockImplementation(
      (projectId: string, issueNumber: number) => {
        if (issueNumber === 105) {
          return Promise.resolve({ dismissed: true, id: "external-105" });
        }

        if (issueNumber === 106) {
          return Promise.resolve({
            dismissed: false,
            id: "external-106",
            importedWorkItemId: "item-9",
          });
        }

        return Promise.resolve({ dismissed: false, id: "external-104" });
      },
    );

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(gitHubRepository.updateExternalIssue).toHaveBeenCalledWith(
      "external-104",
      expect.objectContaining({ title: "Updated title" }),
    );
    expect(gitHubRepository.upsertExternalIssue).not.toHaveBeenCalled();
    expect(summary.detected).toBe(0);
  });

  it("stores pull requests and advances the schedule", async () => {
    const { client, gitHubRepository, projectRepository, service } =
      dependencies;
    client.listPullRequests.mockResolvedValue([
      {
        branch: "feature/github-sync",
        merged: false,
        number: 91,
        state: "open",
        title: "GitHub Sync",
        updatedAt: NOW,
        url: "https://github.com/user/pages/pull/91",
      },
    ]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(gitHubRepository.upsertPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ number: 91 }),
    );
    expect(summary.pullRequests).toBe(1);
    expect(projectRepository.updateSyncSchedule).toHaveBeenCalledWith(
      "project-1",
      {
        lastSyncAt: NOW,
        nextSyncAt: "2026-09-05T14:36:00.000Z",
      },
    );
  });

  it("leaves manual integrations unscheduled", async () => {
    const { projectRepository, service } = dependencies;
    projectRepository.findIntegration.mockResolvedValue(
      createIntegration({ syncIntervalMinutes: 0 }),
    );

    await service.syncProjectNow(createUser(), "project-1");

    expect(projectRepository.updateSyncSchedule).toHaveBeenCalledWith(
      "project-1",
      { lastSyncAt: NOW, nextSyncAt: null },
    );
  });

  it("skips pull request sync when disabled", async () => {
    const { client, projectRepository, service } = dependencies;
    projectRepository.findIntegration.mockResolvedValue(
      createIntegration({ syncPullRequests: false }),
    );

    await service.syncProjectNow(createUser(), "project-1");

    expect(client.listPullRequests).not.toHaveBeenCalled();
  });

  it("refuses runs without a stored token", async () => {
    const { projectRepository, service } = dependencies;
    projectRepository.findTokenEncrypted.mockResolvedValue(null);

    await expect(
      service.syncProjectNow(createUser(), "project-1"),
    ).rejects.toThrow("not connected");
  });

  it("refuses runs with an invalid repository address", async () => {
    const { projectRepository, service } = dependencies;
    projectRepository.findIntegration.mockResolvedValue(
      createIntegration({ repoUrl: "not-a-github-address" }),
    );

    await expect(
      service.syncProjectNow(createUser(), "project-1"),
    ).rejects.toThrow("not connected");
  });

  it("skips linked issues missing from the remote", async () => {
    const { client, service, taskRepository } = dependencies;
    taskRepository.findAll.mockResolvedValue([createWorkItem()]);
    client.listIssues.mockResolvedValue([]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(summary).toMatchObject({ pushed: 0, pulled: 0 });
    expect(taskRepository.update).not.toHaveBeenCalled();
  });

  it("pushes title-only and state-only changes", async () => {
    const { client, service, taskRepository } = dependencies;

    taskRepository.findAll.mockResolvedValue([
      createWorkItem({ title: "Renamed task" }),
    ]);
    client.listIssues.mockResolvedValue([createRemoteIssue()]);

    await service.syncProjectNow(createUser(), "project-1");

    expect(client.updateIssue).toHaveBeenCalledWith("user", "pages", 82, {
      title: "Renamed task",
    });

    client.updateIssue.mockClear();
    taskRepository.findAll.mockResolvedValue([
      createWorkItem({
        githubContentHash: computeGitHubContentHash(
          "GitHub Synchronisation implementieren",
          "Implement sync",
          false,
        ),
        isDone: true,
        statusId: "status-done",
        statusKey: "done",
        statusName: "Done",
      }),
    ]);

    await service.syncProjectNow(createUser(), "project-1");

    expect(client.updateIssue).toHaveBeenCalledWith("user", "pages", 82, {
      state: "closed",
    });
  });

  it("reopens done tasks when remote issues reopen", async () => {
    const { client, service, taskRepository } = dependencies;
    taskRepository.findAll.mockResolvedValue([
      createWorkItem({
        githubContentHash: computeGitHubContentHash(
          "GitHub Synchronisation implementieren",
          "Implement sync",
          true,
        ),
        isDone: true,
        statusId: "status-done",
        statusKey: "done",
        statusName: "Done",
      }),
    ]);
    client.listIssues.mockResolvedValue([
      createRemoteIssue({ updatedAt: "2026-09-05T14:20:00.000Z" }),
    ]);

    await service.syncProjectNow(createUser(), "project-1");

    expect(taskRepository.update).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ statusId: "status-backlog" }),
    );
  });

  it("closes newly created remote issues for done tasks", async () => {
    const { client, service, taskRepository } = dependencies;
    taskRepository.findAll.mockResolvedValue([
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
        isDone: true,
        statusId: "status-done",
        statusKey: "done",
        statusName: "Done",
      }),
    ]);
    client.listIssues.mockResolvedValue([]);

    await service.syncProjectNow(createUser(), "project-1");

    expect(client.createIssue).toHaveBeenCalledTimes(1);
    expect(client.updateIssue).toHaveBeenCalledWith("user", "pages", 99, {
      state: "closed",
    });
  });

  it("withholds pushes in pull-only direction", async () => {
    const { client, projectRepository, service, taskRepository } = dependencies;
    projectRepository.findIntegration.mockResolvedValue(
      createIntegration({ syncDirection: "pull" }),
    );
    taskRepository.findAll.mockResolvedValue([
      createWorkItem({ description: "Changed locally" }),
    ]);
    client.listIssues.mockResolvedValue([createRemoteIssue()]);

    const summary = await service.syncProjectNow(createUser(), "project-1");

    expect(summary).toMatchObject({ pushed: 0, pulled: 0 });
    expect(client.updateIssue).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService scheduled runs", () => {
  let dependencies: ReturnType<typeof createDependencies>;

  beforeEach(() => {
    dependencies = createDependencies();
  });

  it("synchronizes due projects and counts failures", async () => {
    const { projectRepository, service } = dependencies;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    projectRepository.findDueSyncIntegrations.mockResolvedValue([
      { ownerId: "user-1", projectId: "project-1" },
      { ownerId: "user-2", projectId: "project-2" },
    ]);
    projectRepository.findIntegration
      .mockResolvedValueOnce(createIntegration())
      .mockRejectedValueOnce(new Error("Database gone"));

    const result = await service.runScheduledSyncs();

    expect(result).toEqual({ completed: 1, failed: 1 });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("project-2"),
      expect.any(Error),
    );
    log.mockRestore();
  });

  it("skips projects without an active owner", async () => {
    const { projectRepository, service, userRepository } = dependencies;
    projectRepository.findDueSyncIntegrations.mockResolvedValue([
      { ownerId: "missing", projectId: "project-1" },
      { ownerId: "inactive", projectId: "project-2" },
    ]);
    userRepository.findById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createUser({ isActive: false }));

    const result = await service.runScheduledSyncs();

    expect(result).toEqual({ completed: 0, failed: 0 });
  });
});

describe("GitHubSyncService single task runs", () => {
  let dependencies: ReturnType<typeof createDependencies>;

  beforeEach(() => {
    dependencies = createDependencies();
  });

  it("denies runs without write permission", async () => {
    const { projectService, service } = dependencies;
    projectService.canWriteProject.mockResolvedValue(false);

    await expect(
      service.syncSingleTask(createUser(), "item-1"),
    ).rejects.toThrow(ProjectManagementDeniedError);
  });

  it("rejects tasks without a GitHub link", async () => {
    const { service, taskService } = dependencies;
    taskService.getById.mockResolvedValue(
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    );

    await expect(
      service.syncSingleTask(createUser(), "item-1"),
    ).rejects.toThrow(WorkItemValidationError);
  });

  it("refuses runs without a connected integration", async () => {
    const { projectRepository, service } = dependencies;
    projectRepository.findIntegration.mockResolvedValue(null);

    await expect(
      service.syncSingleTask(createUser(), "item-1"),
    ).rejects.toThrow("not connected");
  });

  it("synchronizes one linked task", async () => {
    const { client, service, taskService } = dependencies;
    taskService.getById.mockResolvedValue(createWorkItem());
    client.getIssue.mockResolvedValue(createRemoteIssue());

    const summary = await service.syncSingleTask(createUser(), "item-1");

    expect(summary).toMatchObject({ pushed: 0, pulled: 0 });
    expect(client.getIssue).toHaveBeenCalledWith("user", "pages", 82);
  });

  it("skips conflicted tasks in single runs", async () => {
    const { client, service, taskService } = dependencies;
    taskService.getById.mockResolvedValue(
      createWorkItem({ githubConflict: true }),
    );

    const summary = await service.syncSingleTask(createUser(), "item-1");

    expect(summary).toMatchObject({ pushed: 0, pulled: 0, conflicts: 0 });
    expect(client.getIssue).not.toHaveBeenCalled();
  });
});

describe("GitHubSyncService publishing", () => {
  let dependencies: ReturnType<typeof createDependencies>;

  beforeEach(() => {
    dependencies = createDependencies();
  });

  it("ignores non-tasks, conflicts, and disconnected projects", async () => {
    const { client, projectRepository, service } = dependencies;
    const actor = createUser();

    await service.publishTaskUpdate(
      actor,
      createWorkItem({ type: WORK_ITEM_TYPE.EPIC }),
    );
    await service.publishTaskUpdate(
      actor,
      createWorkItem({ githubConflict: true }),
    );

    projectRepository.findIntegration.mockResolvedValue(null);
    await service.publishTaskUpdate(actor, createWorkItem());

    projectRepository.findIntegration.mockResolvedValue(
      createIntegration({ syncDirection: "pull" }),
    );
    await service.publishTaskUpdate(actor, createWorkItem());

    expect(client.getIssue).not.toHaveBeenCalled();
    expect(client.createIssue).not.toHaveBeenCalled();
  });

  it("creates missing remote issues for new tasks", async () => {
    const { client, service, taskRepository } = dependencies;

    await service.publishTaskUpdate(
      createUser(),
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    );

    expect(client.createIssue).toHaveBeenCalledWith(
      "user",
      "pages",
      expect.objectContaining({
        title: "GitHub Synchronisation implementieren",
      }),
    );
    expect(taskRepository.updateGitHubLink).toHaveBeenCalled();
  });

  it("skips issue creation when issue sync is disabled", async () => {
    const { client, projectRepository, service } = dependencies;
    projectRepository.findIntegration.mockResolvedValue(
      createIntegration({ syncIssues: false }),
    );

    await service.publishTaskUpdate(
      createUser(),
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    );

    expect(client.createIssue).not.toHaveBeenCalled();
  });

  it("pushes linked tasks to existing issues", async () => {
    const { client, service } = dependencies;

    await service.publishTaskUpdate(
      createUser(),
      createWorkItem({ description: "Changed locally" }),
    );

    expect(client.updateIssue).toHaveBeenCalledWith(
      "user",
      "pages",
      82,
      expect.objectContaining({ body: "Changed locally" }),
    );
  });
});

describe("GitHubSyncService external issue triage", () => {
  let dependencies: ReturnType<typeof createDependencies>;

  beforeEach(() => {
    dependencies = createDependencies();
  });

  it("rejects imports without permission or triage state", async () => {
    const { gitHubRepository, projectService, service } = dependencies;
    const actor = createUser();

    projectService.canWriteProject.mockResolvedValue(false);
    await expect(
      service.importExternalIssue(actor, "project-1", 104),
    ).rejects.toThrow(ProjectManagementDeniedError);

    projectService.canWriteProject.mockResolvedValue(true);
    gitHubRepository.findExternalIssueByNumber.mockResolvedValue(null);
    await expect(
      service.importExternalIssue(actor, "project-1", 104),
    ).rejects.toThrow(WorkItemValidationError);

    gitHubRepository.findExternalIssueByNumber.mockResolvedValue({
      dismissed: true,
      id: "external-104",
    });
    await expect(
      service.importExternalIssue(actor, "project-1", 104),
    ).rejects.toThrow(WorkItemValidationError);
  });

  it("refuses imports without a connected integration", async () => {
    const { gitHubRepository, projectRepository, service } = dependencies;
    gitHubRepository.findExternalIssueByNumber.mockResolvedValue({
      dismissed: false,
      id: "external-104",
      importedWorkItemId: null,
      issueNumber: 104,
    });
    projectRepository.findIntegration.mockResolvedValue(null);

    await expect(
      service.importExternalIssue(createUser(), "project-1", 104),
    ).rejects.toThrow("not connected");
  });

  it("imports external issues as linked tasks", async () => {
    const { client, gitHubRepository, service, taskRepository, taskService } =
      dependencies;
    gitHubRepository.findExternalIssueByNumber.mockResolvedValue({
      dismissed: false,
      id: "external-104",
      importedWorkItemId: null,
      issueNumber: 104,
    });
    client.getIssue.mockResolvedValue(
      createRemoteIssue({
        body: "External body",
        number: 104,
        title: "External title",
        url: "https://github.com/user/pages/issues/104",
      }),
    );
    taskService.create.mockResolvedValue(createWorkItem({ id: "item-new" }));
    taskRepository.findById.mockResolvedValue(
      createWorkItem({ id: "item-new" }),
    );

    const imported = await service.importExternalIssue(
      createUser(),
      "project-1",
      104,
    );

    expect(taskService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        skipGitHubSync: true,
        title: "External title",
      }),
    );
    expect(gitHubRepository.markExternalIssueImported).toHaveBeenCalledWith(
      "external-104",
      "item-new",
    );
    expect(imported.id).toBe("item-new");
  });

  it("pulls without an open fallback status", async () => {
    const { client, service, taskRepository } = dependencies;
    taskRepository.findAllStatuses.mockResolvedValue([
      {
        id: "status-done",
        isDone: true,
        key: "done",
        name: "Done",
        position: 5,
        projectId: null,
      },
    ]);
    taskRepository.findAll.mockResolvedValue([
      createWorkItem({
        githubContentHash: computeGitHubContentHash(
          "GitHub Synchronisation implementieren",
          "Implement sync",
          true,
        ),
        isDone: true,
        statusId: "status-done",
        statusKey: "done",
        statusName: "Done",
      }),
    ]);
    client.listIssues.mockResolvedValue([
      createRemoteIssue({ updatedAt: "2026-09-05T14:20:00.000Z" }),
    ]);

    await service.syncProjectNow(createUser(), "project-1");

    expect(taskRepository.update).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ statusId: "status-done" }),
    );
  });

  it("falls back through workflow statuses for imports", async () => {
    const { gitHubRepository, service, taskRepository, taskService } =
      dependencies;
    gitHubRepository.findExternalIssueByNumber.mockResolvedValue({
      dismissed: false,
      id: "external-104",
      importedWorkItemId: null,
      issueNumber: 104,
    });
    taskRepository.findAllStatuses.mockResolvedValue([
      {
        id: "status-done",
        isDone: true,
        key: "done",
        name: "Done",
        position: 5,
        projectId: null,
      },
    ]);
    taskRepository.findById.mockResolvedValue(
      createWorkItem({ id: "item-new" }),
    );

    await service.importExternalIssue(createUser(), "project-1", 104);

    expect(taskService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ statusId: "status-done" }),
    );
  });

  it("reports missing workflow statuses for imports", async () => {
    const { gitHubRepository, service, taskRepository } = dependencies;
    gitHubRepository.findExternalIssueByNumber.mockResolvedValue({
      dismissed: false,
      id: "external-104",
      importedWorkItemId: null,
      issueNumber: 104,
    });
    taskRepository.findAllStatuses.mockResolvedValue([]);

    await expect(
      service.importExternalIssue(createUser(), "project-1", 104),
    ).rejects.toThrow("No workflow status");
  });

  it("reports missing tasks after import", async () => {
    const { gitHubRepository, service, taskRepository } = dependencies;
    gitHubRepository.findExternalIssueByNumber.mockResolvedValue({
      dismissed: false,
      id: "external-104",
      importedWorkItemId: null,
      issueNumber: 104,
    });
    taskRepository.findById.mockResolvedValue(null);

    await expect(
      service.importExternalIssue(createUser(), "project-1", 104),
    ).rejects.toThrow("could not be retrieved");
  });

  it("links external issues to existing tasks", async () => {
    const { client, gitHubRepository, service, taskRepository, taskService } =
      dependencies;
    taskService.getById.mockResolvedValue(
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    );
    gitHubRepository.findExternalIssueById.mockResolvedValue({
      dismissed: false,
      id: "external-104",
      importedWorkItemId: null,
      issueNumber: 104,
      projectId: "project-1",
    });
    client.getIssue.mockResolvedValue(
      createRemoteIssue({
        body: "External body",
        number: 104,
        title: "External title",
        url: "https://github.com/user/pages/issues/104",
      }),
    );
    taskRepository.findById.mockResolvedValue(createWorkItem());

    const linked = await service.linkExternalIssue(
      createUser(),
      "item-1",
      "external-104",
    );

    expect(taskRepository.update).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ title: "External title" }),
    );
    expect(linked.key).toBe("PAGE-42");
  });

  it("denies link requests without write permission", async () => {
    const { projectService, service, taskService } = dependencies;
    taskService.getById.mockResolvedValue(
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    );
    projectService.canWriteProject.mockResolvedValue(false);

    await expect(
      service.linkExternalIssue(createUser(), "item-1", "external-104"),
    ).rejects.toThrow(ProjectManagementDeniedError);
  });

  it("refuses links without a connected integration", async () => {
    const { gitHubRepository, projectRepository, service, taskService } =
      dependencies;
    taskService.getById.mockResolvedValue(
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    );
    gitHubRepository.findExternalIssueById.mockResolvedValue({
      dismissed: false,
      id: "external-104",
      importedWorkItemId: null,
      issueNumber: 104,
      projectId: "project-1",
    });
    projectRepository.findIntegration.mockResolvedValue(null);

    await expect(
      service.linkExternalIssue(createUser(), "item-1", "external-104"),
    ).rejects.toThrow("not connected");
  });

  it("rejects invalid link requests", async () => {
    const { gitHubRepository, service, taskService } = dependencies;
    const actor = createUser();

    taskService.getById.mockResolvedValue(
      createWorkItem({ type: WORK_ITEM_TYPE.EPIC }),
    );
    await expect(
      service.linkExternalIssue(actor, "epic-1", "external-104"),
    ).rejects.toThrow("Only tasks can be linked");

    taskService.getById.mockResolvedValue(createWorkItem());
    await expect(
      service.linkExternalIssue(actor, "item-1", "external-104"),
    ).rejects.toThrow("already linked");

    taskService.getById.mockResolvedValue(
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    );
    gitHubRepository.findExternalIssueById.mockResolvedValue({
      dismissed: false,
      id: "external-104",
      importedWorkItemId: null,
      issueNumber: 104,
      projectId: "foreign-project",
    });
    await expect(
      service.linkExternalIssue(actor, "item-1", "external-104"),
    ).rejects.toThrow("cannot be linked");

    gitHubRepository.findExternalIssueById.mockResolvedValue(null);
    await expect(
      service.linkExternalIssue(actor, "item-1", "external-104"),
    ).rejects.toThrow("cannot be linked");
  });

  it("reports missing tasks after linking", async () => {
    const { gitHubRepository, service, taskRepository, taskService } =
      dependencies;
    taskService.getById.mockResolvedValue(
      createWorkItem({
        githubContentHash: null,
        githubIssueNumber: null,
        githubIssueState: null,
        githubIssueUpdatedAt: null,
        githubIssueUrl: null,
        githubLastSyncAt: null,
      }),
    );
    gitHubRepository.findExternalIssueById.mockResolvedValue({
      dismissed: false,
      id: "external-104",
      importedWorkItemId: null,
      issueNumber: 104,
      projectId: "project-1",
    });
    taskRepository.findById.mockResolvedValue(null);

    await expect(
      service.linkExternalIssue(createUser(), "item-1", "external-104"),
    ).rejects.toThrow("could not be retrieved");
  });

  it("dismisses external issues with permission checks", async () => {
    const { gitHubRepository, projectService, service } = dependencies;
    const actor = createUser();

    gitHubRepository.findExternalIssueById.mockResolvedValue(null);
    await expect(
      service.dismissExternalIssue(actor, "missing"),
    ).rejects.toThrow(WorkItemValidationError);

    gitHubRepository.findExternalIssueById.mockResolvedValue({
      id: "external-104",
      projectId: "project-1",
    });
    projectService.canWriteProject.mockResolvedValue(false);
    await expect(
      service.dismissExternalIssue(actor, "external-104"),
    ).rejects.toThrow(ProjectManagementDeniedError);

    projectService.canWriteProject.mockResolvedValue(true);
    await service.dismissExternalIssue(actor, "external-104");
    expect(gitHubRepository.dismissExternalIssue).toHaveBeenCalledWith(
      "external-104",
    );
  });
});

describe("GitHubSyncService pull requests", () => {
  let dependencies: ReturnType<typeof createDependencies>;

  beforeEach(() => {
    dependencies = createDependencies();
  });

  it("assigns pull requests within one project", async () => {
    const { gitHubRepository, service, taskService } = dependencies;
    const actor = createUser();
    gitHubRepository.findPullRequestById.mockResolvedValue({
      id: "pr-1",
      projectId: "project-1",
    });
    taskService.getById.mockResolvedValue(createWorkItem());

    await service.assignPullRequest(actor, "pr-1", "item-1");
    expect(gitHubRepository.assignPullRequest).toHaveBeenCalledWith(
      "pr-1",
      "item-1",
    );

    await service.assignPullRequest(actor, "pr-1", null);
    expect(gitHubRepository.assignPullRequest).toHaveBeenCalledWith(
      "pr-1",
      null,
    );
  });

  it("rejects invalid pull request assignments", async () => {
    const { gitHubRepository, projectService, service, taskService } =
      dependencies;
    const actor = createUser();

    gitHubRepository.findPullRequestById.mockResolvedValue(null);
    await expect(
      service.assignPullRequest(actor, "pr-1", "item-1"),
    ).rejects.toThrow(WorkItemValidationError);

    gitHubRepository.findPullRequestById.mockResolvedValue({
      id: "pr-1",
      projectId: "project-1",
    });
    projectService.canWriteProject.mockResolvedValue(false);
    await expect(
      service.assignPullRequest(actor, "pr-1", "item-1"),
    ).rejects.toThrow(ProjectManagementDeniedError);

    projectService.canWriteProject.mockResolvedValue(true);
    taskService.getById.mockResolvedValue(
      createWorkItem({ projectId: "foreign-project" }),
    );
    await expect(
      service.assignPullRequest(actor, "pr-1", "item-1"),
    ).rejects.toThrow("same project");
  });

  it("exposes pull request reads with access checks", async () => {
    const { gitHubRepository, service } = dependencies;
    const actor = createUser();

    await service.findPullRequests(actor, "project-1");
    expect(gitHubRepository.findPullRequestsByProject).toHaveBeenCalledWith(
      "project-1",
    );

    await service.findPullRequestsForTask(actor, "item-1");
    expect(gitHubRepository.findPullRequestsByWorkItem).toHaveBeenCalledWith(
      "item-1",
    );

    await service.findExternalIssues(actor, "project-1");
    expect(gitHubRepository.findExternalIssues).toHaveBeenCalledWith(
      "project-1",
    );
  });
});

describe("GitHubSyncService conflicts and connections", () => {
  let dependencies: ReturnType<typeof createDependencies>;

  beforeEach(() => {
    dependencies = createDependencies();
  });

  it("resolves conflicts in favor of either side", async () => {
    const { client, service, taskRepository, taskService } = dependencies;
    const actor = createUser();
    taskService.getById.mockResolvedValue(
      createWorkItem({
        description: "Changed locally",
        githubConflict: true,
      }),
    );
    client.getIssue.mockResolvedValue(createRemoteIssue());
    taskRepository.findById.mockResolvedValue(createWorkItem());

    await service.resolveConflict(actor, "item-1", "pages");
    expect(client.updateIssue).toHaveBeenCalled();

    await service.resolveConflict(actor, "item-1", "github");
    expect(taskRepository.update).toHaveBeenCalled();
    expect(taskRepository.setGitHubConflict).toHaveBeenCalledWith(
      "item-1",
      false,
    );
  });

  it("rejects conflict resolution without conflicts or permission", async () => {
    const { projectService, service, taskService } = dependencies;
    const actor = createUser();

    taskService.getById.mockResolvedValue(createWorkItem());
    await expect(
      service.resolveConflict(actor, "item-1", "pages"),
    ).rejects.toThrow(WorkItemValidationError);

    taskService.getById.mockResolvedValue(
      createWorkItem({ githubConflict: true }),
    );
    projectService.canWriteProject.mockResolvedValue(false);
    await expect(
      service.resolveConflict(actor, "item-1", "pages"),
    ).rejects.toThrow(ProjectManagementDeniedError);
  });

  it("refuses resolutions without a connected integration", async () => {
    const { projectRepository, service, taskService } = dependencies;
    taskService.getById.mockResolvedValue(
      createWorkItem({ githubConflict: true }),
    );
    projectRepository.findIntegration.mockResolvedValue(null);

    await expect(
      service.resolveConflict(createUser(), "item-1", "pages"),
    ).rejects.toThrow("not connected");
  });

  it("reports missing tasks after resolution", async () => {
    const { service, taskRepository, taskService } = dependencies;
    taskService.getById.mockResolvedValue(
      createWorkItem({ githubConflict: true }),
    );
    taskRepository.findById.mockResolvedValue(null);

    await expect(
      service.resolveConflict(createUser(), "item-1", "github"),
    ).rejects.toThrow("could not be retrieved");
  });

  it("tests connections against the GitHub API", async () => {
    const { client, projectRepository, service } = dependencies;
    const actor = createUser();

    await expect(service.testConnection(actor, "project-1")).resolves.toBe(
      true,
    );
    expect(projectRepository.upsertIntegration).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ isConnected: true, repoName: "user/pages" }),
    );

    client.getRepository.mockRejectedValue(new Error("Unauthorized"));

    await expect(service.testConnection(actor, "project-1")).resolves.toBe(
      false,
    );
    expect(projectRepository.upsertIntegration).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({ isConnected: false }),
    );
  });

  it("denies connection tests without write permission", async () => {
    const { projectService, service } = dependencies;
    projectService.canWriteProject.mockResolvedValue(false);

    await expect(
      service.testConnection(createUser(), "project-1"),
    ).rejects.toThrow(ProjectManagementDeniedError);
  });

  it("reports missing integrations as failed connections", async () => {
    const { projectRepository, service } = dependencies;
    projectRepository.findIntegration.mockResolvedValue(null);

    await expect(
      service.testConnection(createUser(), "project-1"),
    ).resolves.toBe(false);
  });

  it("tests tokenless integrations through the public client", async () => {
    const { client, projectRepository, service } = dependencies;
    projectRepository.findTokenEncrypted.mockResolvedValue(null);

    await expect(
      service.testConnection(createUser(), "project-1"),
    ).resolves.toBe(true);
    expect(client.getRepository).toHaveBeenCalledWith("user", "pages");
  });
});

describe("GitHubSyncService cached batch reads", () => {
  it("caches external issues and pull requests by project set", async () => {
    const cache = new ServerCache();
    const dependencies = createDependencies(cache);
    dependencies.gitHubRepository.findExternalIssuesByProjectIds.mockResolvedValue(
      new Map([["project-1", []]]),
    );
    dependencies.gitHubRepository.findPullRequestsByProjectIds.mockResolvedValue(
      new Map([["project-1", []]]),
    );

    await dependencies.service.findExternalIssuesByProjects(["project-1"]);
    await dependencies.service.findExternalIssuesByProjects(["project-1"]);
    expect(
      dependencies.gitHubRepository.findExternalIssuesByProjectIds,
    ).toHaveBeenCalledTimes(1);

    await dependencies.service.findPullRequestsByProjects(["project-1"]);
    await dependencies.service.findPullRequestsByProjects(["project-1"]);
    expect(
      dependencies.gitHubRepository.findPullRequestsByProjectIds,
    ).toHaveBeenCalledTimes(1);
  });
});
