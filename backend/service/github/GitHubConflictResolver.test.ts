import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import { GitHubConflictResolver } from "./GitHubConflictResolver";
import {
  hashRemoteIssueContent,
  hashWorkItemContent,
} from "./GitHubIssueMapping";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { GitHubChangeEvents } from "./GitHubLocalChange";
import type { GitHubIssuePuller } from "./GitHubIssuePuller";
import type { GitHubIssuePusher } from "./GitHubIssuePusher";
import type { GitHubSyncAccessGuard } from "./GitHubSyncAccessGuard";
import type { GitHubSyncContextLoader } from "./GitHubSyncContextLoader";
import type { LinkedIssueRun } from "./GitHubSyncRun";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { User } from "@/definition/User";

function anyString(): string {
  return expect.any(String) as string;
}

const ACTOR = { id: "user-1" } as unknown as User;
const REMOTE: GitHubIssueData = {
  body: "Body",
  number: 5,
  state: "open",
  title: "Title",
  updatedAt: "2026-01-02T00:00:00.000Z",
  url: "https://github.com/o/r/issues/5",
};
const STATUSES: WorkflowStatus[] = [];

function task(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    archivedAt: null,
    description: "Body",
    githubConflict: false,
    githubContentHash: null,
    githubIssueNumber: 5,
    id: "task-1",
    isDone: false,
    key: "PG-1",
    projectId: "project-1",
    title: "Title",
    ...overrides,
  } as unknown as WorkItemDetail;
}

function setup(
  direction: "bidirectional" | "push" | "pull" = "bidirectional",
): {
  readonly accessGuard: Record<string, Mock>;
  readonly getIssue: Mock;
  readonly projectRepository: Record<string, Mock>;
  readonly puller: Record<string, Mock>;
  readonly pusher: Record<string, Mock>;
  readonly resolver: GitHubConflictResolver;
  readonly sync: object;
  readonly taskRepository: Record<string, Mock>;
} {
  const getIssue = vi.fn().mockResolvedValue(REMOTE);
  const sync = {
    client: { getIssue },
    integration: { syncDirection: direction },
    repo: { owner: "owner", repo: "repo" },
  };
  const taskRepository = {
    findAllStatuses: vi.fn().mockResolvedValue([
      { id: "global", projectId: null },
      { id: "mine", projectId: "project-1" },
      { id: "other", projectId: "project-2" },
    ]),
    findById: vi.fn(),
    setGitHubConflict: vi.fn().mockResolvedValue(undefined),
  };
  const projectRepository = {
    insertActivity: vi.fn().mockResolvedValue(undefined),
  };
  const accessGuard = {
    requireWritableTask: vi.fn(),
    visibility: vi.fn().mockResolvedValue({ departmentIds: null }),
  };
  const contextLoader = { requireContext: vi.fn().mockResolvedValue(sync) };
  const pusher = { pushLocalState: vi.fn().mockResolvedValue(undefined) };
  const puller = { pullRemoteState: vi.fn().mockResolvedValue(undefined) };
  const events: GitHubChangeEvents = { announce: vi.fn((work) => work()) };
  const resolver = new GitHubConflictResolver({
    accessGuard: accessGuard as unknown as GitHubSyncAccessGuard,
    contextLoader: contextLoader as unknown as GitHubSyncContextLoader,
    events,
    projectRepository: projectRepository as unknown as ProjectRepository,
    puller: puller as unknown as GitHubIssuePuller,
    pusher: pusher as unknown as GitHubIssuePusher,
    taskRepository: taskRepository as unknown as TaskRepository,
  });

  return {
    accessGuard,
    getIssue,
    projectRepository,
    puller,
    pusher,
    resolver,
    sync,
    taskRepository,
  };
}

function runOf(
  fixture: ReturnType<typeof setup>,
  item: WorkItemDetail,
  remote: GitHubIssueData = REMOTE,
): LinkedIssueRun {
  return {
    actor: ACTOR,
    issueNumber: 5,
    item,
    remote,
    summary: {
      conflicts: 0,
      created: 0,
      detected: 0,
      pulled: 0,
      pullRequests: 0,
      pushed: 0,
    },
    sync: fixture.sync as unknown as LinkedIssueRun["sync"],
  };
}

describe("reconcile", () => {
  it("does nothing when neither side changed", async () => {
    const fixture = setup();
    const item = task();
    const run = runOf(fixture, {
      ...item,
      githubContentHash: hashWorkItemContent(item),
    });

    await fixture.resolver.reconcile(run, STATUSES);

    expect(fixture.pusher.pushLocalState).not.toHaveBeenCalled();
    expect(fixture.puller.pullRemoteState).not.toHaveBeenCalled();
    expect(run.summary.conflicts).toBe(0);
  });

  it("flags a change on both sides without overwriting", async () => {
    const fixture = setup();
    const item = task({ githubContentHash: "stale", title: "Local" });
    const run = runOf(fixture, item);

    await fixture.resolver.reconcile(run, STATUSES);

    expect(fixture.taskRepository.setGitHubConflict).toHaveBeenCalledWith(
      "task-1",
      true,
    );
    expect(fixture.projectRepository.insertActivity).toHaveBeenCalledWith({
      action: "github_conflict",
      category: "integrations",
      id: anyString(),
      message:
        "Task PG-1 changed in Pages and on GitHub and needs a manual decision.",
      projectId: "project-1",
      userId: "user-1",
      workItemId: "task-1",
    });
    expect(run.summary.conflicts).toBe(1);
    expect(fixture.pusher.pushLocalState).not.toHaveBeenCalled();
  });

  it("pushes a local change when the direction allows it", async () => {
    const fixture = setup();
    const baseline = task({ title: "Baseline" });
    const run = runOf(
      fixture,
      task({ githubContentHash: hashWorkItemContent(baseline) }),
      { ...REMOTE, title: "Baseline" },
    );

    await fixture.resolver.reconcile(run, STATUSES);

    expect(fixture.pusher.pushLocalState).toHaveBeenCalledWith(run);
  });

  it("treats a task without a stored hash as locally changed", async () => {
    const fixture = setup();
    const run = runOf(fixture, task());

    await fixture.resolver.reconcile(run, STATUSES);

    expect(fixture.pusher.pushLocalState).toHaveBeenCalledWith(run);
  });

  it("leaves a local change alone when pushing is not allowed", async () => {
    const fixture = setup("pull");
    const run = runOf(fixture, task());

    await fixture.resolver.reconcile(run, STATUSES);

    expect(fixture.pusher.pushLocalState).not.toHaveBeenCalled();
    expect(fixture.puller.pullRemoteState).not.toHaveBeenCalled();
  });

  it("pulls a remote change when the direction allows it", async () => {
    const fixture = setup();
    const item = task();
    const run = runOf(
      fixture,
      { ...item, githubContentHash: hashWorkItemContent(item) },
      { ...REMOTE, title: "Changed remotely" },
    );

    await fixture.resolver.reconcile(run, STATUSES);

    expect(fixture.puller.pullRemoteState).toHaveBeenCalledWith(run, STATUSES);
  });

  it("leaves a remote change alone when pulling is not allowed", async () => {
    const fixture = setup("push");
    const item = task();
    const run = runOf(
      fixture,
      { ...item, githubContentHash: hashWorkItemContent(item) },
      { ...REMOTE, title: "Changed remotely" },
    );

    await fixture.resolver.reconcile(run, STATUSES);

    expect(fixture.puller.pullRemoteState).not.toHaveBeenCalled();
    expect(hashRemoteIssueContent(run.remote)).not.toBe(
      run.item.githubContentHash,
    );
  });
});

describe("resolve", () => {
  function conflicted(): WorkItemDetail {
    return task({ githubConflict: true });
  }

  it.each([
    ["not flagged", task()],
    ["not linked", task({ githubConflict: true, githubIssueNumber: null })],
  ])("rejects a task that is %s", async (_, item) => {
    const fixture = setup();
    fixture.accessGuard.requireWritableTask.mockResolvedValue(item);

    const rejection = fixture.resolver.resolve(ACTOR, "task-1", "pages");

    await expect(rejection).rejects.toBeInstanceOf(WorkItemValidationError);
    await expect(rejection).rejects.toMatchObject({ code: "githubNoConflict" });
  });

  it("pushes the Pages values and clears the flag with the change", async () => {
    const fixture = setup();
    const item = conflicted();
    const resolved = task();
    fixture.accessGuard.requireWritableTask.mockResolvedValue(item);
    fixture.taskRepository.findById.mockResolvedValue(resolved);

    await expect(
      fixture.resolver.resolve(ACTOR, "task-1", "pages"),
    ).resolves.toBe(resolved);

    expect(fixture.getIssue).toHaveBeenCalledWith("owner", "repo", 5);
    const [run, clearConflict] = fixture.pusher.pushLocalState.mock
      .calls[0] as [LinkedIssueRun, () => Promise<void>];
    expect(run).toMatchObject({
      actor: ACTOR,
      issueNumber: 5,
      item,
      remote: REMOTE,
    });
    await clearConflict();
    expect(fixture.taskRepository.setGitHubConflict).toHaveBeenCalledWith(
      "task-1",
      false,
    );
    expect(fixture.taskRepository.findById).toHaveBeenCalledWith("task-1", {
      departmentIds: null,
    });
  });

  it("pulls the GitHub values with the statuses of the project", async () => {
    const fixture = setup();
    fixture.accessGuard.requireWritableTask.mockResolvedValue(conflicted());
    fixture.taskRepository.findById.mockResolvedValue(task());

    await fixture.resolver.resolve(ACTOR, "task-1", "github");

    const [, statuses, clearConflict] = fixture.puller.pullRemoteState.mock
      .calls[0] as [LinkedIssueRun, { id: string }[], () => Promise<void>];
    expect(statuses.map((status) => status.id)).toEqual(["global", "mine"]);
    await clearConflict();
    expect(fixture.taskRepository.setGitHubConflict).toHaveBeenCalledWith(
      "task-1",
      false,
    );
  });

  it("fails when the resolved task cannot be read back", async () => {
    const fixture = setup();
    fixture.accessGuard.requireWritableTask.mockResolvedValue(conflicted());
    fixture.taskRepository.findById.mockResolvedValue(null);

    await expect(
      fixture.resolver.resolve(ACTOR, "task-1", "pages"),
    ).rejects.toThrow("Resolved task could not be retrieved.");
  });
});
