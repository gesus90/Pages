import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { GitHubIssuePuller } from "./GitHubIssuePuller";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { GitHubChangeEvents } from "./GitHubLocalChange";
import type { LinkedIssueRun } from "@/backend/service/github/GitHubSyncRun";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";

const REMOTE: GitHubIssueData = {
  body: "Remote body",
  number: 4,
  state: "closed",
  title: "Remote title",
  updatedAt: "2026-01-02T00:00:00.000Z",
  url: "https://github.com/o/r/issues/4",
};
const ITEM = {
  archivedAt: null,
  assigneeGroupId: null,
  assigneeId: null,
  createdBy: "creator-1",
  description: "Old",
  dueAt: null,
  id: "task-1",
  isDone: false,
  milestoneId: null,
  parentId: null,
  priority: "normal",
  startAt: null,
  statusId: "open",
  title: "Old",
} as unknown as WorkItemDetail;
const STATUSES: WorkflowStatus[] = [
  {
    id: "done",
    isDone: true,
    key: "done",
    name: "Done",
    position: 1,
    projectId: null,
  },
];

function setup(): {
  readonly puller: GitHubIssuePuller;
  readonly run: LinkedIssueRun;
  readonly taskRepository: Record<string, Mock>;
  readonly order: string[];
} {
  const order: string[] = [];
  const taskRepository = {
    insertHistory: vi.fn(() => {
      order.push("history");
      return Promise.resolve();
    }),
    updateFromGitHub: vi.fn(() => {
      order.push("update");
      return Promise.resolve();
    }),
    updateGitHubLink: vi.fn(() => {
      order.push("link");
      return Promise.resolve();
    }),
  };
  const events: GitHubChangeEvents = {
    announce: async <Result>(work: () => Promise<Result>): Promise<Result> => {
      order.push("announce");
      return work();
    },
  };
  const puller = new GitHubIssuePuller(
    taskRepository as unknown as TaskRepository,
    () => "2026-03-01T00:00:00.000Z",
    events,
  );
  const run: LinkedIssueRun = {
    actor: { id: "user-1" } as unknown as LinkedIssueRun["actor"],
    issueNumber: 4,
    item: ITEM,
    remote: REMOTE,
    summary: {
      conflicts: 0,
      created: 0,
      detected: 0,
      pulled: 0,
      pullRequests: 0,
      pushed: 0,
    },
    sync: {} as unknown as LinkedIssueRun["sync"],
  };

  return { puller, run, taskRepository, order };
}

describe("pullRemoteState", () => {
  it("writes ticket, history, and link, then counts the pull", async () => {
    const { puller, run, taskRepository, order } = setup();

    await puller.pullRemoteState(run, STATUSES);

    expect(order).toEqual(["announce", "update", "history", "link"]);
    expect(taskRepository.updateFromGitHub).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        description: "Remote body",
        statusId: "done",
        title: "Remote title",
      }),
    );
    expect(taskRepository.updateGitHubLink).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        issueNumber: 4,
        lastSyncAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    expect(run.summary.pulled).toBe(1);
  });

  it("runs the additional writes inside the same change", async () => {
    const { puller, run, order } = setup();
    const alsoApply = vi.fn(() => {
      order.push("also");
      return Promise.resolve();
    });

    await puller.pullRemoteState(run, STATUSES, alsoApply);

    expect(order).toEqual(["announce", "update", "history", "link", "also"]);
  });
});
