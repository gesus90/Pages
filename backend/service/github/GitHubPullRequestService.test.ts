import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import { GitHubPullRequestService } from "./GitHubPullRequestService";

import type { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import type { GitHubPullRequestData } from "@/backend/github/GitHubApiClient";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { TaskService } from "@/backend/service/TaskService";
import type { GitHubChangeEvents } from "./GitHubLocalChange";
import type { GitHubSyncAccessGuard } from "./GitHubSyncAccessGuard";
import type { GitHubSyncContext } from "./GitHubSyncContextLoader";
import type { GitHubSyncCounters } from "./GitHubSyncRun";
import type { User } from "@/definition/User";

function anyString(): string {
  return expect.any(String) as string;
}

const ACTOR = { id: "user-1" } as unknown as User;
const VISIBILITY = { departmentIds: null };

function pullRequest(number: number): GitHubPullRequestData {
  return {
    branch: `branch-${String(number)}`,
    merged: number === 2,
    number,
    state: "open",
    title: `PR ${String(number)}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    url: `https://github.com/o/r/pull/${String(number)}`,
  };
}

function setup(): {
  readonly accessGuard: Record<string, Mock>;
  readonly announced: boolean[];
  readonly gitHubRepository: Record<string, Mock>;
  readonly service: GitHubPullRequestService;
  readonly taskService: Record<string, Mock>;
} {
  const gitHubRepository = {
    assignPullRequest: vi.fn().mockResolvedValue(undefined),
    findPullRequestById: vi.fn(),
    findPullRequestsByProject: vi.fn().mockResolvedValue([]),
    upsertPullRequest: vi.fn().mockResolvedValue(false),
  };
  const accessGuard = {
    requireWritableProject: vi.fn().mockResolvedValue(undefined),
    visibility: vi.fn().mockResolvedValue(VISIBILITY),
  };
  const taskService = { getById: vi.fn() };
  const announced: boolean[] = [];
  const events: GitHubChangeEvents = {
    announce: async <Result>(
      work: () => Promise<Result>,
      decide: (result: Result) => readonly PagesEvent[],
    ): Promise<Result> => {
      const result = await work();
      announced.push(decide(result).length > 0);
      return result;
    },
  };
  const service = new GitHubPullRequestService(
    gitHubRepository as unknown as GitHubRepository,
    accessGuard as unknown as GitHubSyncAccessGuard,
    taskService as unknown as TaskService,
    events,
  );

  return { accessGuard, announced, gitHubRepository, service, taskService };
}

function counters(): GitHubSyncCounters {
  return {
    conflicts: 0,
    created: 0,
    detected: 0,
    pulled: 0,
    pullRequests: 0,
    pushed: 0,
  };
}

describe("storeRemotePullRequests", () => {
  function syncWith(requests: GitHubPullRequestData[]): {
    readonly listPullRequests: Mock;
    readonly sync: GitHubSyncContext;
  } {
    const listPullRequests = vi.fn().mockResolvedValue(requests);

    return {
      listPullRequests,
      sync: {
        client: { listPullRequests },
        repo: { owner: "owner", repo: "repo" },
      } as unknown as GitHubSyncContext,
    };
  }

  it("stores every pull request and counts the visible ones", async () => {
    const fixture = setup();
    const { sync, listPullRequests } = syncWith([
      pullRequest(1),
      pullRequest(2),
      pullRequest(3),
    ]);
    fixture.gitHubRepository.upsertPullRequest
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    fixture.gitHubRepository.findPullRequestsByProject.mockResolvedValue([
      { number: 1 },
      { number: 3 },
    ]);
    const summary = counters();

    await fixture.service.storeRemotePullRequests(
      sync,
      "project-1",
      summary,
      VISIBILITY,
    );

    expect(listPullRequests).toHaveBeenCalledWith("owner", "repo", "all");
    expect(fixture.gitHubRepository.upsertPullRequest).toHaveBeenCalledWith({
      branch: "branch-2",
      id: anyString(),
      merged: true,
      number: 2,
      projectId: "project-1",
      state: "open",
      title: "PR 2",
      url: "https://github.com/o/r/pull/2",
    });
    expect(
      fixture.gitHubRepository.findPullRequestsByProject,
    ).toHaveBeenCalledWith("project-1", VISIBILITY);
    expect(fixture.announced).toEqual([true]);
    expect(summary.pullRequests).toBe(2);
  });

  it("announces nothing when no pull request changed", async () => {
    const fixture = setup();
    const { sync } = syncWith([pullRequest(1)]);

    await fixture.service.storeRemotePullRequests(
      sync,
      "project-1",
      counters(),
      VISIBILITY,
    );

    expect(fixture.announced).toEqual([false]);
  });
});

describe("assign", () => {
  const stored = { id: "pr-1", projectId: "project-1" };

  it("rejects a pull request the actor cannot see", async () => {
    const fixture = setup();
    fixture.gitHubRepository.findPullRequestById.mockResolvedValue(null);

    const rejection = fixture.service.assign(ACTOR, "pr-1", null);

    await expect(rejection).rejects.toBeInstanceOf(WorkItemValidationError);
    await expect(rejection).rejects.toMatchObject({
      code: "githubPullRequestNotAssignable",
    });
    expect(fixture.gitHubRepository.findPullRequestById).toHaveBeenCalledWith(
      "pr-1",
      VISIBILITY,
    );
  });

  it("clears the assignment without resolving a task", async () => {
    const fixture = setup();
    fixture.gitHubRepository.findPullRequestById.mockResolvedValue(stored);

    await fixture.service.assign(ACTOR, "pr-1", null);

    expect(fixture.accessGuard.requireWritableProject).toHaveBeenCalledWith(
      ACTOR,
      "project-1",
    );
    expect(fixture.taskService.getById).not.toHaveBeenCalled();
    expect(fixture.gitHubRepository.assignPullRequest).toHaveBeenCalledWith(
      "pr-1",
      null,
    );
  });

  it("assigns a task of the same project", async () => {
    const fixture = setup();
    fixture.gitHubRepository.findPullRequestById.mockResolvedValue(stored);
    fixture.taskService.getById.mockResolvedValue({ projectId: "project-1" });

    await fixture.service.assign(ACTOR, "pr-1", "task-1");

    expect(fixture.taskService.getById).toHaveBeenCalledWith(ACTOR, "task-1");
    expect(fixture.gitHubRepository.assignPullRequest).toHaveBeenCalledWith(
      "pr-1",
      "task-1",
    );
  });

  it("rejects a task of another project", async () => {
    const fixture = setup();
    fixture.gitHubRepository.findPullRequestById.mockResolvedValue(stored);
    fixture.taskService.getById.mockResolvedValue({ projectId: "project-2" });

    await expect(
      fixture.service.assign(ACTOR, "pr-1", "task-1"),
    ).rejects.toMatchObject({ code: "githubPullRequestOtherProject" });
    expect(fixture.gitHubRepository.assignPullRequest).not.toHaveBeenCalled();
  });
});
