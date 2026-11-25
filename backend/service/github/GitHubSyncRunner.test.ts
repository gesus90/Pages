import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { GitHubSyncRunner } from "./GitHubSyncRunner";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { GitHubConflictResolver } from "./GitHubConflictResolver";
import type { GitHubExternalIssueDetector } from "./GitHubExternalIssueDetector";
import type { GitHubIssuePusher } from "./GitHubIssuePusher";
import type { GitHubPullRequestService } from "./GitHubPullRequestService";
import type { GitHubSyncAccessGuard } from "./GitHubSyncAccessGuard";
import type { GitHubSyncContextLoader } from "./GitHubSyncContextLoader";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

const mocks = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));

const ACTOR = { id: "user-1", isActive: true } as unknown as User;
const NOW = "2026-03-01T00:00:00.000Z";
const VISIBILITY = { departmentIds: null };

interface IntegrationOverrides {
  syncDirection?: string;
  syncIntervalMinutes?: number;
  syncIssues?: boolean;
  syncPullRequests?: boolean;
}

function task(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    githubConflict: false,
    githubIssueNumber: null,
    id: "task-1",
    projectId: "project-1",
    type: "task",
    ...overrides,
  } as unknown as WorkItemDetail;
}

function issue(number: number): Record<string, unknown> {
  return { body: "", number, state: "open", title: "T", url: "u" };
}

function setup(overrides: IntegrationOverrides = {}): {
  readonly accessGuard: Record<string, Mock>;
  readonly client: Record<string, Mock>;
  readonly conflictResolver: Record<string, Mock>;
  readonly contextLoader: Record<string, Mock>;
  readonly externalIssueDetector: Record<string, Mock>;
  readonly projectRepository: Record<string, Mock>;
  readonly pullRequestService: Record<string, Mock>;
  readonly pusher: Record<string, Mock>;
  readonly runner: GitHubSyncRunner;
  readonly sync: object;
  readonly taskRepository: Record<string, Mock>;
  readonly userRepository: Record<string, Mock>;
} {
  const client = {
    getIssue: vi.fn().mockResolvedValue(issue(5)),
    listIssues: vi.fn().mockResolvedValue([issue(5), issue(6)]),
  };
  const sync = {
    client,
    integration: {
      syncDirection: "bidirectional",
      syncIntervalMinutes: 15,
      syncIssues: true,
      syncPullRequests: true,
      ...overrides,
    },
    repo: { owner: "owner", repo: "repo" },
  };
  const taskRepository = {
    findAll: vi.fn().mockResolvedValue([]),
    findAllStatuses: vi.fn().mockResolvedValue([
      { id: "global", projectId: null },
      { id: "mine", projectId: "project-1" },
      { id: "other", projectId: "project-2" },
    ]),
    findArchivedLinkedWorkItems: vi.fn().mockResolvedValue([]),
  };
  const projectRepository = {
    deferNextSync: vi.fn().mockResolvedValue(undefined),
    findDueSyncIntegrations: vi.fn().mockResolvedValue([]),
    findTokenEncrypted: vi.fn().mockResolvedValue("encrypted"),
    markIntegrationDisconnected: vi.fn().mockResolvedValue(undefined),
    updateSyncSchedule: vi.fn().mockResolvedValue(undefined),
  };
  const userRepository = { findById: vi.fn().mockResolvedValue(ACTOR) };
  const accessGuard = {
    requireWritableProject: vi.fn().mockResolvedValue(undefined),
    requireWritableTask: vi.fn(),
    visibility: vi.fn().mockResolvedValue(VISIBILITY),
  };
  const contextLoader = { requireContext: vi.fn().mockResolvedValue(sync) };
  const pusher = { createRemoteIssue: vi.fn().mockResolvedValue(undefined) };
  const conflictResolver = { reconcile: vi.fn().mockResolvedValue(undefined) };
  const externalIssueDetector = {
    detect: vi.fn().mockResolvedValue(undefined),
  };
  const pullRequestService = {
    storeRemotePullRequests: vi.fn().mockResolvedValue(undefined),
  };
  const runner = new GitHubSyncRunner({
    accessGuard: accessGuard as unknown as GitHubSyncAccessGuard,
    conflictResolver: conflictResolver as unknown as GitHubConflictResolver,
    contextLoader: contextLoader as unknown as GitHubSyncContextLoader,
    externalIssueDetector:
      externalIssueDetector as unknown as GitHubExternalIssueDetector,
    now: () => NOW,
    projectRepository: projectRepository as unknown as ProjectRepository,
    pullRequestService:
      pullRequestService as unknown as GitHubPullRequestService,
    pusher: pusher as unknown as GitHubIssuePusher,
    taskRepository: taskRepository as unknown as TaskRepository,
    userRepository: userRepository as unknown as UserRepository,
  });

  return {
    accessGuard,
    client,
    conflictResolver,
    contextLoader,
    externalIssueDetector,
    projectRepository,
    pullRequestService,
    pusher,
    runner,
    sync,
    taskRepository,
    userRepository,
  };
}

beforeEach(() => {
  mocks.logCaughtError.mockReset();
});

describe("runProject", () => {
  it("synchronizes issues, detections, and pull requests, then schedules", async () => {
    const fixture = setup();
    fixture.taskRepository.findAll.mockResolvedValue([
      task({ id: "unlinked" }),
      task({ githubIssueNumber: 5, id: "linked" }),
    ]);
    fixture.taskRepository.findArchivedLinkedWorkItems.mockResolvedValue([
      task({ githubIssueNumber: 5, id: "archived" }),
    ]);

    const summary = await fixture.runner.runProject(ACTOR, "project-1");

    expect(summary).toEqual({
      conflicts: 0,
      created: 0,
      detected: 0,
      pulled: 0,
      pullRequests: 0,
      pushed: 0,
    });
    expect(fixture.accessGuard.requireWritableProject).toHaveBeenCalledWith(
      ACTOR,
      "project-1",
    );
    expect(fixture.taskRepository.findAll).toHaveBeenCalledWith({
      projectIds: ["project-1"],
      type: "task",
      visibility: VISIBILITY,
    });
    expect(fixture.client.listIssues).toHaveBeenCalledWith(
      "owner",
      "repo",
      "all",
    );
    expect(fixture.pusher.createRemoteIssue).toHaveBeenCalledTimes(1);
    expect(fixture.pusher.createRemoteIssue).toHaveBeenCalledWith(
      fixture.sync,
      ACTOR,
      expect.objectContaining({ id: "unlinked" }),
      summary,
    );
    expect(fixture.conflictResolver.reconcile).toHaveBeenCalledTimes(2);
    const [run, statuses] = fixture.conflictResolver.reconcile.mock
      .calls[0] as [unknown, { id: string }[]];
    expect(run).toMatchObject({ actor: ACTOR, issueNumber: 5 });
    expect(statuses.map((status) => status.id)).toEqual(["global", "mine"]);
    expect(fixture.externalIssueDetector.detect).toHaveBeenCalledWith(
      "project-1",
      expect.any(Map),
      summary,
    );
    expect(
      fixture.pullRequestService.storeRemotePullRequests,
    ).toHaveBeenCalledWith(fixture.sync, "project-1", summary, VISIBILITY);
    expect(fixture.projectRepository.updateSyncSchedule).toHaveBeenCalledWith(
      "project-1",
      { lastSyncAt: NOW, nextSyncAt: "2026-03-01T00:15:00.000Z" },
    );
  });

  it("skips issues and pull requests when they are not synchronized", async () => {
    const fixture = setup({
      syncIntervalMinutes: 0,
      syncIssues: false,
      syncPullRequests: false,
    });
    fixture.taskRepository.findAll.mockResolvedValue([task()]);

    await fixture.runner.runProject(ACTOR, "project-1");

    expect(fixture.client.listIssues).not.toHaveBeenCalled();
    expect(fixture.pusher.createRemoteIssue).not.toHaveBeenCalled();
    expect(fixture.externalIssueDetector.detect).not.toHaveBeenCalled();
    expect(
      fixture.pullRequestService.storeRemotePullRequests,
    ).not.toHaveBeenCalled();
    expect(fixture.projectRepository.updateSyncSchedule).toHaveBeenCalledWith(
      "project-1",
      { lastSyncAt: NOW, nextSyncAt: null },
    );
  });
});

describe("runProject task selection", () => {
  it.each([
    ["initiatives", { type: "initiative" }, "bidirectional"],
    ["any task when pushing is off", {}, "pull"],
  ])("does not create issues for %s", async (_, overrides, direction) => {
    const fixture = setup({ syncDirection: direction });
    fixture.taskRepository.findAll.mockResolvedValue([
      task(overrides as Partial<WorkItemDetail>),
    ]);

    await fixture.runner.runProject(ACTOR, "project-1");

    expect(fixture.pusher.createRemoteIssue).not.toHaveBeenCalled();
  });

  it("leaves conflicted tasks and tasks without a remote issue alone", async () => {
    const fixture = setup();
    fixture.taskRepository.findAll.mockResolvedValue([
      task({ githubConflict: true, githubIssueNumber: 5 }),
      task({ githubIssueNumber: 99 }),
    ]);

    await fixture.runner.runProject(ACTOR, "project-1");

    expect(fixture.conflictResolver.reconcile).not.toHaveBeenCalled();
  });

  it("releases the project and keeps the failure when the run fails", async () => {
    const fixture = setup();
    const failure = new Error("denied");
    fixture.accessGuard.requireWritableProject.mockRejectedValue(failure);

    await expect(fixture.runner.runProject(ACTOR, "project-1")).rejects.toBe(
      failure,
    );

    fixture.accessGuard.requireWritableProject.mockResolvedValue(undefined);
    fixture.projectRepository.findDueSyncIntegrations.mockResolvedValue([
      { ownerId: "user-1", projectId: "project-1" },
    ]);
    await expect(fixture.runner.runDue()).resolves.toMatchObject({
      completed: 1,
    });
  });
});

describe("runDue", () => {
  const entry = { ownerId: "user-1", projectId: "project-1" };

  it("counts completed projects and lists the changed ones", async () => {
    const fixture = setup();
    fixture.projectRepository.findDueSyncIntegrations.mockResolvedValue([
      entry,
      { ownerId: "user-1", projectId: "project-2" },
    ]);
    fixture.pullRequestService.storeRemotePullRequests.mockImplementation(
      (_: unknown, projectId: string, summary: { pullRequests: number }) => {
        if (projectId === "project-2") summary.pullRequests = 1;
        return Promise.resolve();
      },
    );

    await expect(fixture.runner.runDue()).resolves.toEqual({
      changedProjectIds: ["project-2"],
      completed: 2,
      failed: 0,
    });
    expect(
      fixture.projectRepository.findDueSyncIntegrations,
    ).toHaveBeenCalledWith(NOW);
  });

  it("skips owners that are missing or inactive", async () => {
    const fixture = setup();
    fixture.projectRepository.findDueSyncIntegrations.mockResolvedValue([
      entry,
      entry,
    ]);
    fixture.userRepository.findById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...ACTOR, isActive: false });

    await expect(fixture.runner.runDue()).resolves.toEqual({
      changedProjectIds: [],
      completed: 0,
      failed: 0,
    });
  });

  it("skips a project that is still running", async () => {
    const fixture = setup();
    let finishRun: () => void = () => undefined;
    fixture.accessGuard.requireWritableProject.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRun = resolve;
        }),
    );
    const manual = fixture.runner.runProject(ACTOR, "project-1");
    const concurrent = fixture.runner.runProject(ACTOR, "project-1");
    fixture.projectRepository.findDueSyncIntegrations.mockResolvedValue([
      entry,
    ]);

    await expect(fixture.runner.runDue()).resolves.toMatchObject({
      completed: 0,
      failed: 0,
    });

    finishRun();
    await Promise.all([manual, concurrent]);
    await expect(fixture.runner.runDue()).resolves.toMatchObject({
      completed: 1,
    });
  });

  it("backs off a failing project and carries on", async () => {
    const fixture = setup();
    const failure = new Error("boom");
    fixture.projectRepository.findDueSyncIntegrations.mockResolvedValue([
      entry,
    ]);
    fixture.contextLoader.requireContext.mockRejectedValue(failure);

    await expect(fixture.runner.runDue()).resolves.toEqual({
      changedProjectIds: [],
      completed: 0,
      failed: 1,
    });
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "GitHubSyncRunner",
      failure,
    );
    expect(fixture.projectRepository.deferNextSync).toHaveBeenCalledWith(
      "project-1",
      "2026-03-01T00:01:00.000Z",
    );
  });
});

describe("runSingleTask", () => {
  it("rejects a task without a linked issue", async () => {
    const fixture = setup();
    fixture.accessGuard.requireWritableTask.mockResolvedValue(task());

    await expect(
      fixture.runner.runSingleTask(ACTOR, "task-1"),
    ).rejects.toMatchObject({ code: "githubTaskNotLinked" });
  });

  it("reconciles the linked task with the statuses of its project", async () => {
    const fixture = setup();
    const item = task({ githubIssueNumber: 5 });
    fixture.accessGuard.requireWritableTask.mockResolvedValue(item);

    const summary = await fixture.runner.runSingleTask(ACTOR, "task-1");

    expect(summary.pushed).toBe(0);
    expect(fixture.client.getIssue).toHaveBeenCalledWith("owner", "repo", 5);
    const [run, statuses] = fixture.conflictResolver.reconcile.mock
      .calls[0] as [unknown, { id: string }[]];
    expect(run).toMatchObject({ actor: ACTOR, issueNumber: 5, item });
    expect(statuses.map((status) => status.id)).toEqual(["global", "mine"]);
  });

  it("leaves a conflicted task alone", async () => {
    const fixture = setup();
    fixture.accessGuard.requireWritableTask.mockResolvedValue(
      task({ githubConflict: true, githubIssueNumber: 5 }),
    );

    await fixture.runner.runSingleTask(ACTOR, "task-1");

    expect(fixture.client.getIssue).not.toHaveBeenCalled();
    expect(fixture.conflictResolver.reconcile).not.toHaveBeenCalled();
  });
});

describe("releaseProject", () => {
  it("tolerates releasing a project that is not registered", () => {
    const { runner } = setup();
    const internals = runner as unknown as {
      releaseProject(projectId: string): void;
    };

    expect(() => {
      internals.releaseProject("unregistered");
    }).not.toThrow();
  });
});
