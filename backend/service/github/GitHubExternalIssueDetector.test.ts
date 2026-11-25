import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { GitHubExternalIssueDetector } from "./GitHubExternalIssueDetector";

import type { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { GitHubChangeEvents } from "./GitHubLocalChange";
import type { GitHubSyncCounters } from "@/backend/service/github/GitHubSyncRun";

function anyString(): string {
  return expect.any(String) as string;
}

function issue(
  number: number,
  overrides: Partial<GitHubIssueData> = {},
): GitHubIssueData {
  return {
    body: "",
    number,
    state: "open",
    title: `Issue ${String(number)}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    url: `https://github.com/o/r/issues/${String(number)}`,
    ...overrides,
  } satisfies GitHubIssueData;
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

function setup(
  linked: number[],
  findExternalIssueByNumber: (number: number) => unknown,
): {
  readonly detector: GitHubExternalIssueDetector;
  readonly gitHub: Record<string, Mock>;
  readonly announced: boolean[];
} {
  const gitHub = {
    findExternalIssueByNumber: vi.fn((_: string, number: number) =>
      Promise.resolve(findExternalIssueByNumber(number)),
    ),
    updateExternalIssue: vi.fn().mockResolvedValue(undefined),
    upsertExternalIssue: vi.fn().mockResolvedValue(undefined),
  };
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
  const detector = new GitHubExternalIssueDetector(
    {
      findKnownGitHubIssueNumbers: vi.fn().mockResolvedValue(new Set(linked)),
    } as unknown as TaskRepository,
    gitHub as unknown as GitHubRepository,
    events,
  );

  return { detector, gitHub, announced };
}

describe("detect", () => {
  it("skips issues that a task already links to", async () => {
    const { detector, gitHub, announced } = setup([1], () => null);
    const summary = counters();

    await detector.detect("project-1", new Map([[1, issue(1)]]), summary);

    expect(gitHub.findExternalIssueByNumber).not.toHaveBeenCalled();
    expect(summary.detected).toBe(0);
    expect(announced).toEqual([false]);
  });

  it("records a new external issue and counts it", async () => {
    const { detector, gitHub, announced } = setup([], () => null);
    const summary = counters();

    await detector.detect("project-1", new Map([[2, issue(2)]]), summary);

    expect(gitHub.upsertExternalIssue).toHaveBeenCalledWith({
      id: anyString(),
      issueNumber: 2,
      projectId: "project-1",
      state: "open",
      title: "Issue 2",
      url: "https://github.com/o/r/issues/2",
    });
    expect(summary.detected).toBe(1);
    expect(announced).toEqual([true]);
  });

  it("leaves dismissed and imported issues untouched", async () => {
    const known = new Map([
      [3, { dismissed: true, importedWorkItemId: null }],
      [4, { dismissed: false, importedWorkItemId: "task-4" }],
    ]);
    const { detector, gitHub, announced } = setup([], (n) => known.get(n));
    const summary = counters();

    await detector.detect(
      "project-1",
      new Map([
        [3, issue(3)],
        [4, issue(4)],
      ]),
      summary,
    );

    expect(gitHub.updateExternalIssue).not.toHaveBeenCalled();
    expect(gitHub.upsertExternalIssue).not.toHaveBeenCalled();
    expect(announced).toEqual([false]);
  });

  it("does not write an unchanged known issue again", async () => {
    const remote = issue(5);
    const { detector, gitHub, announced } = setup([], () => ({
      dismissed: false,
      id: "external-5",
      importedWorkItemId: null,
      state: remote.state,
      title: remote.title,
      url: remote.url,
    }));

    await detector.detect("project-1", new Map([[5, remote]]), counters());

    expect(gitHub.updateExternalIssue).not.toHaveBeenCalled();
    expect(announced).toEqual([false]);
  });

  const CHANGES: readonly (readonly [string, Partial<GitHubIssueData>])[] = [
    ["state", { state: "closed" }],
    ["title", { title: "Renamed" }],
    ["url", { url: "https://github.com/o/r/issues/moved" }],
  ];

  it.each(CHANGES)(
    "refreshes a known issue whose %s changed",
    async (_, change) => {
      const base = issue(6);
      const { detector, gitHub, announced } = setup([], () => ({
        dismissed: false,
        id: "external-6",
        importedWorkItemId: null,
        state: base.state,
        title: base.title,
        url: base.url,
      }));
      const summary = counters();

      await detector.detect(
        "project-1",
        new Map([[6, issue(6, change)]]),
        summary,
      );

      expect(gitHub.updateExternalIssue).toHaveBeenCalledWith("external-6", {
        state: change.state ?? base.state,
        title: change.title ?? base.title,
        url: change.url ?? base.url,
      });
      expect(summary.detected).toBe(0);
      expect(announced).toEqual([true]);
    },
  );
});
