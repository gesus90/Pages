import { describe, expect, it } from "vitest";

import {
  getWorkItemGitHubSyncState,
  isLabelColor,
  isWorkItemPriority,
  isWorkItemType,
  LABEL_COLORS,
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
  WORKFLOW_STATUS_KEY,
} from "@/definition/Task";

describe("task definitions", () => {
  it("exposes every supported work item type", () => {
    expect(WORK_ITEM_TYPE).toEqual({
      EPIC: "epic",
      INITIATIVE: "initiative",
      SUBTASK: "subtask",
      TASK: "task",
    });
  });

  it("exposes every supported work item priority", () => {
    expect(WORK_ITEM_PRIORITY).toEqual({
      HIGH: "high",
      LOW: "low",
      NORMAL: "normal",
      URGENT: "urgent",
    });
  });

  it("exposes built-in workflow status keys", () => {
    expect(WORKFLOW_STATUS_KEY).toEqual({
      BACKLOG: "backlog",
      DONE: "done",
      IN_PROGRESS: "in_progress",
      REVIEW: "review",
      TODO: "todo",
    });
  });
});

describe("isWorkItemType", () => {
  it.each(Object.values(WORK_ITEM_TYPE))("accepts %s", (type) => {
    expect(isWorkItemType(type)).toBe(true);
  });

  it.each(["issue", "", "TASK", null, undefined, 0, true, {}, []])(
    "rejects unsupported value %p",
    (value) => {
      expect(isWorkItemType(value)).toBe(false);
    },
  );
});

describe("isWorkItemPriority", () => {
  it.each(Object.values(WORK_ITEM_PRIORITY))("accepts %s", (priority) => {
    expect(isWorkItemPriority(priority)).toBe(true);
  });

  it.each(["critical", "", "HIGH", null, undefined, 0, true, {}, []])(
    "rejects unsupported value %p",
    (value) => {
      expect(isWorkItemPriority(value)).toBe(false);
    },
  );
});

describe("isLabelColor", () => {
  it("exposes twelve curated label colors", () => {
    expect(LABEL_COLORS).toHaveLength(12);
  });

  it.each([...LABEL_COLORS])("accepts %s", (color) => {
    expect(isLabelColor(color)).toBe(true);
  });

  it.each(["red", "", "#FFF", null, undefined, 0, true, {}, []])(
    "rejects unsupported value %p",
    (value) => {
      expect(isLabelColor(value)).toBe(false);
    },
  );
});

describe("getWorkItemGitHubSyncState", () => {
  it("reports unlinked tickets without an issue number", () => {
    expect(
      getWorkItemGitHubSyncState({
        githubConflict: false,
        githubIssueNumber: null,
        githubLastError: null,
        githubLastSyncAt: null,
        updatedAt: "2026-09-05T14:00:00.000Z",
      }),
    ).toBe("unlinked");
  });

  it("reports conflicts and stored errors as failed", () => {
    expect(
      getWorkItemGitHubSyncState({
        githubConflict: true,
        githubIssueNumber: 42,
        githubLastError: null,
        githubLastSyncAt: "2026-09-05T14:00:00.000Z",
        updatedAt: "2026-09-05T14:00:00.000Z",
      }),
    ).toBe("failed");

    expect(
      getWorkItemGitHubSyncState({
        githubConflict: false,
        githubIssueNumber: 42,
        githubLastError: "Forbidden",
        githubLastSyncAt: "2026-09-05T14:00:00.000Z",
        updatedAt: "2026-09-05T14:00:00.000Z",
      }),
    ).toBe("failed");
  });

  it("reports never-synced tickets as pending", () => {
    expect(
      getWorkItemGitHubSyncState({
        githubConflict: false,
        githubIssueNumber: 42,
        githubLastError: null,
        githubLastSyncAt: null,
        updatedAt: "2026-09-05T14:00:00.000Z",
      }),
    ).toBe("pending");
  });

  it("reports locally changed tickets as pending", () => {
    expect(
      getWorkItemGitHubSyncState({
        githubConflict: false,
        githubIssueNumber: 42,
        githubLastError: null,
        githubLastSyncAt: "2026-09-05T14:00:00.000Z",
        updatedAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toBe("pending");

    expect(
      getWorkItemGitHubSyncState({
        githubConflict: false,
        githubIssueNumber: 42,
        githubLastError: null,
        githubLastSyncAt: "not-a-date",
        updatedAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toBe("pending");

    expect(
      getWorkItemGitHubSyncState({
        githubConflict: false,
        githubIssueNumber: 42,
        githubLastError: null,
        githubLastSyncAt: "2026-09-05T15:00:00.000Z",
        updatedAt: "not-a-date",
      }),
    ).toBe("pending");
  });

  it("reports synchronized tickets as synced", () => {
    expect(
      getWorkItemGitHubSyncState({
        githubConflict: false,
        githubIssueNumber: 42,
        githubLastError: null,
        githubLastSyncAt: "2026-09-05T15:00:00.000Z",
        updatedAt: "2026-09-05T14:00:00.000Z",
      }),
    ).toBe("synced");
  });
});
