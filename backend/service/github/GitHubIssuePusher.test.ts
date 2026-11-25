import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { WORK_ITEM_TYPE } from "@/definition/Task";

import { GitHubIssuePusher } from "./GitHubIssuePusher";
import {
  gitHubCreationKey,
  gitHubCreationMarker,
} from "./GitHubCreationIdentity";

import type { GitHubCreationRepository } from "@/backend/database/repositories/integrations/GitHubCreationRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { GitHubChangeEvents } from "./GitHubLocalChange";
import type {
  GitHubSyncContext,
  GitHubSyncContextLoader,
} from "./GitHubSyncContextLoader";
import type { GitHubSyncCounters, LinkedIssueRun } from "./GitHubSyncRun";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

const ACTOR = { id: "user-1" } as unknown as User;
const NOW = "2026-03-01T00:00:00.000Z";
const KEY = gitHubCreationKey("owner/repo", "task-1");
const MARKER = gitHubCreationMarker(KEY);

function issue(overrides: Partial<GitHubIssueData> = {}): GitHubIssueData {
  return {
    body: "Body",
    number: 5,
    state: "open",
    title: "Title",
    updatedAt: "2026-01-02T00:00:00.000Z",
    url: "https://github.com/o/r/issues/5",
    ...overrides,
  };
}

function task(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    archivedAt: null,
    description: "Body",
    githubConflict: false,
    githubIssueNumber: 5,
    githubIssueUrl: "https://github.com/o/r/issues/5",
    id: "task-1",
    isDone: false,
    projectId: "project-1",
    title: "Title",
    type: WORK_ITEM_TYPE.TASK,
    ...overrides,
  } as unknown as WorkItemDetail;
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

function announcing(published: PagesEvent[]): GitHubChangeEvents {
  return {
    announce: async <Result>(
      work: () => Promise<Result>,
      decide: (result: Result) => readonly PagesEvent[],
    ): Promise<Result> => {
      const result = await work();
      published.push(...decide(result));
      return result;
    },
  };
}

function setup(withCreations = false): {
  readonly client: Record<string, Mock>;
  readonly contextLoader: Record<string, Mock>;
  readonly creations: Record<string, Mock>;
  readonly pusher: GitHubIssuePusher;
  readonly published: PagesEvent[];
  readonly sync: object;
  readonly taskRepository: Record<string, Mock>;
} {
  const client = {
    createIssue: vi.fn().mockResolvedValue(issue({ body: "Body" })),
    getIssue: vi.fn().mockResolvedValue(issue()),
    listIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(issue({ title: "Updated" })),
  };
  const sync = {
    client,
    integration: { syncDirection: "bidirectional", syncIssues: true },
    repo: { owner: "owner", repo: "repo" },
  };
  const taskRepository = {
    insertHistory: vi.fn().mockResolvedValue(undefined),
    updateGitHubLink: vi.fn().mockResolvedValue(undefined),
  };
  const contextLoader = { findContext: vi.fn().mockResolvedValue(sync) };
  const creations = {
    begin: vi.fn().mockResolvedValue(true),
    confirm: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue(null),
  };
  const published: PagesEvent[] = [];
  const events = announcing(published);
  const pusher = new GitHubIssuePusher(
    taskRepository as unknown as TaskRepository,
    contextLoader as unknown as GitHubSyncContextLoader,
    () => NOW,
    {
      creations: withCreations
        ? (creations as unknown as GitHubCreationRepository)
        : undefined,
      events,
    },
  );

  return {
    client,
    contextLoader,
    creations,
    pusher,
    published,
    sync,
    taskRepository,
  };
}

function runOf(
  sync: unknown,
  item: WorkItemDetail,
  remote: GitHubIssueData,
): LinkedIssueRun {
  return {
    actor: ACTOR,
    issueNumber: 5,
    item,
    remote,
    summary: counters(),
    sync: sync as GitHubSyncContext,
  };
}

describe("publishTaskUpdate", () => {
  it.each([
    ["not a task", task({ type: WORK_ITEM_TYPE.EPIC })],
    ["in conflict", task({ githubConflict: true })],
  ])("ignores an item that is %s", async (_, item) => {
    const { pusher, contextLoader } = setup();

    await pusher.publishTaskUpdate(ACTOR, item);

    expect(contextLoader.findContext).not.toHaveBeenCalled();
  });

  it("ignores a project without context or with pulling only", async () => {
    const fixture = setup();
    fixture.contextLoader.findContext.mockResolvedValueOnce(null);
    await fixture.pusher.publishTaskUpdate(ACTOR, task());

    fixture.contextLoader.findContext.mockResolvedValueOnce({
      ...fixture.sync,
      integration: { syncDirection: "pull", syncIssues: true },
    });
    await fixture.pusher.publishTaskUpdate(ACTOR, task());

    expect(fixture.client.getIssue).not.toHaveBeenCalled();
  });

  it("does not create an issue when issue sync is off", async () => {
    const fixture = setup();
    fixture.contextLoader.findContext.mockResolvedValue({
      ...fixture.sync,
      integration: { syncDirection: "push", syncIssues: false },
    });

    await fixture.pusher.publishTaskUpdate(
      ACTOR,
      task({ githubIssueNumber: null }),
    );

    expect(fixture.client.createIssue).not.toHaveBeenCalled();
  });

  it("creates the issue of an unlinked task", async () => {
    const fixture = setup();

    await fixture.pusher.publishTaskUpdate(
      ACTOR,
      task({ githubIssueNumber: null }),
    );

    expect(fixture.client.createIssue).toHaveBeenCalledWith("owner", "repo", {
      body: "Body",
      title: "Title",
    });
    expect(fixture.taskRepository.updateGitHubLink).toHaveBeenCalled();
  });

  it("pushes the local state to a linked issue", async () => {
    const fixture = setup();

    await fixture.pusher.publishTaskUpdate(
      ACTOR,
      task({ title: "Local title" }),
    );

    expect(fixture.client.getIssue).toHaveBeenCalledWith("owner", "repo", 5);
    expect(fixture.client.updateIssue).toHaveBeenCalledWith(
      "owner",
      "repo",
      5,
      { title: "Local title" },
    );
  });
});

describe("pushLocalState", () => {
  it("only refreshes the baseline when nothing differs", async () => {
    const fixture = setup();
    const run = runOf(fixture.sync, task(), issue());

    await fixture.pusher.pushLocalState(run);

    expect(fixture.client.updateIssue).not.toHaveBeenCalled();
    expect(fixture.taskRepository.updateGitHubLink).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        issueNumber: 5,
        issueUrl: "https://github.com/o/r/issues/5",
        lastSyncAt: NOW,
      }),
    );
    expect(fixture.published).toEqual([]);
    expect(run.summary.pushed).toBe(0);
  });

  it("commits the baseline and further writes with the event", async () => {
    const fixture = setup();
    const alsoApply = vi.fn().mockResolvedValue(undefined);

    await fixture.pusher.pushLocalState(
      runOf(fixture.sync, task(), issue()),
      alsoApply,
    );

    expect(alsoApply).toHaveBeenCalledTimes(1);
    expect(fixture.taskRepository.updateGitHubLink).toHaveBeenCalledTimes(1);
    expect(fixture.published).toEqual([
      { type: "ticket.changed", id: "task-1" },
    ]);
  });

  it("writes the differing values, links, and counts the push", async () => {
    const fixture = setup();
    const alsoApply = vi.fn().mockResolvedValue(undefined);
    const run = runOf(fixture.sync, task({ title: "New" }), issue());

    await fixture.pusher.pushLocalState(run, alsoApply);

    expect(fixture.client.updateIssue).toHaveBeenCalledWith(
      "owner",
      "repo",
      5,
      { title: "New" },
    );
    expect(fixture.taskRepository.updateGitHubLink).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        issueUpdatedAt: issue({ title: "Updated" }).updatedAt,
      }),
    );
    expect(fixture.taskRepository.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({ newValue: "#5" }),
    );
    expect(alsoApply).toHaveBeenCalledTimes(1);
    expect(run.summary.pushed).toBe(1);
  });

  it("pushes without further writes", async () => {
    const fixture = setup();
    const run = runOf(fixture.sync, task({ title: "New" }), issue());

    await fixture.pusher.pushLocalState(run);

    expect(run.summary.pushed).toBe(1);
  });
});

describe("createRemoteIssue", () => {
  it("creates, links, and counts without a creation repository", async () => {
    const fixture = setup();
    const summary = counters();

    await fixture.pusher.createRemoteIssue(
      fixture.sync as unknown as GitHubSyncContext,
      ACTOR,
      task({ githubIssueNumber: null }),
      summary,
    );

    expect(fixture.client.updateIssue).not.toHaveBeenCalled();
    expect(fixture.taskRepository.updateGitHubLink).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ issueNumber: 5 }),
    );
    expect(fixture.taskRepository.insertHistory).toHaveBeenCalled();
    expect(fixture.published).toEqual([
      { type: "ticket.changed", id: "task-1" },
    ]);
    expect(summary.created).toBe(1);
  });

  it("updates a created issue whose content differs", async () => {
    const fixture = setup();
    fixture.client.createIssue.mockResolvedValue(issue({ title: "Stale" }));

    await fixture.pusher.createRemoteIssue(
      fixture.sync as unknown as GitHubSyncContext,
      ACTOR,
      task({ githubIssueNumber: null }),
      counters(),
    );

    expect(fixture.client.updateIssue).toHaveBeenCalledWith(
      "owner",
      "repo",
      5,
      { title: "Title" },
    );
  });
});

describe("createRemoteIssue with creation identities", () => {
  it("creates the issue with a marker and confirms the identity", async () => {
    const fixture = setup(true);
    fixture.client.createIssue.mockResolvedValue(
      issue({ body: `Body${MARKER}` }),
    );

    await fixture.pusher.createRemoteIssue(
      fixture.sync as unknown as GitHubSyncContext,
      ACTOR,
      task({ githubIssueNumber: null }),
      counters(),
    );

    expect(fixture.creations.find).toHaveBeenCalledWith(KEY);
    expect(fixture.client.listIssues).toHaveBeenCalledWith(
      "owner",
      "repo",
      "all",
    );
    expect(fixture.creations.begin).toHaveBeenCalledWith(KEY);
    expect(fixture.client.createIssue).toHaveBeenCalledWith("owner", "repo", {
      body: `Body${MARKER}`,
      title: "Title",
    });
    expect(fixture.creations.confirm).toHaveBeenCalledWith(KEY, 5);
  });

  it("loads the issue of a confirmed creation", async () => {
    const fixture = setup(true);
    fixture.creations.find.mockResolvedValue(5);

    await fixture.pusher.createRemoteIssue(
      fixture.sync as unknown as GitHubSyncContext,
      ACTOR,
      task({ githubIssueNumber: null }),
      counters(),
    );

    expect(fixture.client.getIssue).toHaveBeenCalledWith("owner", "repo", 5);
    expect(fixture.client.createIssue).not.toHaveBeenCalled();
  });

  it("recovers an issue created before a lost acknowledgement", async () => {
    const fixture = setup(true);
    fixture.client.listIssues.mockResolvedValue([
      issue({ body: "Other", number: 1 }),
      issue({ body: `Body${MARKER}`, number: 9 }),
    ]);

    await fixture.pusher.createRemoteIssue(
      fixture.sync as unknown as GitHubSyncContext,
      ACTOR,
      task({ githubIssueNumber: null }),
      counters(),
    );

    expect(fixture.creations.confirm).toHaveBeenCalledWith(KEY, 9);
    expect(fixture.client.createIssue).not.toHaveBeenCalled();
    expect(fixture.taskRepository.updateGitHubLink).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ issueNumber: 9 }),
    );
  });

  it("refuses to create when the earlier outcome is uncertain", async () => {
    const fixture = setup(true);
    fixture.creations.begin.mockResolvedValue(false);

    await expect(
      fixture.pusher.createRemoteIssue(
        fixture.sync as unknown as GitHubSyncContext,
        ACTOR,
        task({ githubIssueNumber: null }),
        counters(),
      ),
    ).rejects.toThrow("GitHub creation outcome is uncertain");
    expect(fixture.client.createIssue).not.toHaveBeenCalled();
  });
});
