import { describe, expect, it } from "vitest";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import {
  buildGitHubIssuePatch,
  buildLinkFromPages,
  buildLinkFromRemote,
  buildSyncHistoryEntry,
  buildWorkItemUpdateFromRemote,
  computeGitHubContentHash,
  findOpenWorkflowStatus,
  hashRemoteIssueContent,
  hashWorkItemContent,
  isEmptyGitHubIssuePatch,
  isWorkItemClosedOnGitHub,
  mapPagesToGitHubState,
  resolvePulledStatusId,
} from "./GitHubIssueMapping";
import { gitHubCreationMarker } from "./GitHubCreationIdentity";

import type { GitHubIssueData } from "@/backend/github/GitHubApiClient";
import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";

function anyString(): string {
  return expect.any(String) as string;
}

function item(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    archivedAt: null,
    assigneeGroupId: "group-1",
    assigneeId: "assignee-1",
    createdBy: "creator-1",
    description: "Body",
    dueAt: "2026-02-01T00:00:00.000Z",
    id: "task-1",
    isDone: false,
    milestoneId: "milestone-1",
    parentId: "parent-1",
    priority: "high",
    startAt: "2026-01-15T00:00:00.000Z",
    statusId: "status-current",
    title: "Title",
    ...overrides,
  } as unknown as WorkItemDetail;
}

function remoteIssue(
  overrides: Partial<GitHubIssueData> = {},
): GitHubIssueData {
  return {
    body: "Body",
    number: 7,
    state: "open",
    title: "Title",
    updatedAt: "2026-01-02T00:00:00.000Z",
    url: "https://github.com/o/r/issues/7",
    ...overrides,
  };
}

function status(id: string, key: string, isDone: boolean): WorkflowStatus {
  return { id, isDone, key, name: key, position: 0, projectId: null };
}

describe("content hashing", () => {
  it("hashes the triple and distinguishes the closed state", () => {
    const open = computeGitHubContentHash("T", "D", false);

    expect(open).toMatch(/^[a-f0-9]{64}$/u);
    expect(computeGitHubContentHash("T", "D", false)).toBe(open);
    expect(computeGitHubContentHash("T", "D", true)).not.toBe(open);
  });

  it("hashes a work item and an equal remote issue to the same value", () => {
    expect(hashWorkItemContent(item())).toBe(
      hashRemoteIssueContent(remoteIssue()),
    );
  });

  it("ignores the creation marker and respects the remote state", () => {
    const marked = remoteIssue({
      body: `Body${gitHubCreationMarker("a".repeat(64))}`,
    });

    expect(hashRemoteIssueContent(marked)).toBe(
      hashRemoteIssueContent(remoteIssue()),
    );
    expect(hashRemoteIssueContent(remoteIssue({ state: "closed" }))).toBe(
      hashWorkItemContent(item({ isDone: true })),
    );
  });
});

describe("closed state", () => {
  it("maps the Pages state onto the GitHub state", () => {
    expect(mapPagesToGitHubState(true)).toBe("closed");
    expect(mapPagesToGitHubState(false)).toBe("open");
  });

  it("treats done and archived items as closed", () => {
    expect(isWorkItemClosedOnGitHub({ isDone: true, archivedAt: null })).toBe(
      true,
    );
    expect(
      isWorkItemClosedOnGitHub({ isDone: false, archivedAt: "2026-01-01" }),
    ).toBe(true);
    expect(isWorkItemClosedOnGitHub({ isDone: false, archivedAt: null })).toBe(
      false,
    );
  });
});

describe("buildGitHubIssuePatch", () => {
  it("is empty when both sides match", () => {
    const patch = buildGitHubIssuePatch(item(), remoteIssue());

    expect(patch).toEqual({});
    expect(isEmptyGitHubIssuePatch(patch)).toBe(true);
  });

  it("contains every differing field and keeps the creation marker", () => {
    const marker = gitHubCreationMarker("b".repeat(64));
    const patch = buildGitHubIssuePatch(
      item({ description: "New", isDone: true, title: "New title" }),
      remoteIssue({ body: `Body${marker}` }),
    );

    expect(patch).toEqual({
      body: `New${marker}`,
      state: "closed",
      title: "New title",
    });
    expect(isEmptyGitHubIssuePatch(patch)).toBe(false);
  });
});

describe("links", () => {
  it("builds the link of an item that adopted the remote issue", () => {
    expect(buildLinkFromRemote(remoteIssue(), "2026-03-01")).toEqual({
      conflict: false,
      contentHash: hashRemoteIssueContent(remoteIssue()),
      issueNumber: 7,
      issueState: "open",
      issueUpdatedAt: "2026-01-02T00:00:00.000Z",
      issueUrl: "https://github.com/o/r/issues/7",
      lastSyncAt: "2026-03-01",
    });
  });

  it("builds the link of an issue that mirrors the item", () => {
    expect(
      buildLinkFromPages(
        item(),
        { number: 9, state: "closed", updatedAt: "u", url: null },
        "2026-03-01",
      ),
    ).toEqual({
      conflict: false,
      contentHash: hashWorkItemContent(item()),
      issueNumber: 9,
      issueState: "closed",
      issueUpdatedAt: "u",
      issueUrl: null,
      lastSyncAt: "2026-03-01",
    });
  });
});

describe("buildSyncHistoryEntry", () => {
  it("records the synchronization with a fresh id", () => {
    const entry = buildSyncHistoryEntry("user-1", "task-1", 12);

    expect(entry).toEqual({
      action: "github_sync",
      field: "github",
      id: anyString(),
      newValue: "#12",
      oldValue: null,
      userId: "user-1",
      workItemId: "task-1",
    });
    expect(buildSyncHistoryEntry("user-1", "task-1", 12).id).not.toBe(entry.id);
  });
});

describe("buildWorkItemUpdateFromRemote", () => {
  it("adopts title and body and keeps the other values", () => {
    const update = buildWorkItemUpdateFromRemote(
      item(),
      remoteIssue({
        body: `Remote${gitHubCreationMarker("c".repeat(64))}`,
        title: "Remote title",
      }),
      "status-next",
    );

    expect(update).toEqual({
      assigneeGroupId: "group-1",
      assigneeId: "assignee-1",
      description: "Remote",
      dueAt: "2026-02-01T00:00:00.000Z",
      milestoneId: "milestone-1",
      parentId: "parent-1",
      priority: "high",
      reporterId: "creator-1",
      startAt: "2026-01-15T00:00:00.000Z",
      statusId: "status-next",
      title: "Remote title",
    });
  });

  it("rejects file sources and agent uploads in the body", () => {
    expect(() =>
      buildWorkItemUpdateFromRemote(
        item(),
        remoteIssue({ body: "![x](file:///etc/passwd)" }),
        "s",
      ),
    ).toThrow(WorkItemValidationError);
    expect(() =>
      buildWorkItemUpdateFromRemote(
        item(),
        remoteIssue({ body: "[x](/agent-assets/abc)" }),
        "s",
      ),
    ).toThrow(WorkItemValidationError);
  });

  it("accepts a ticket attachment reference", () => {
    expect(
      buildWorkItemUpdateFromRemote(
        item(),
        remoteIssue({ body: "[x](/aufgaben/attachments/abc)" }),
        "s",
      ).description,
    ).toBe("[x](/aufgaben/attachments/abc)");
  });
});

describe("findOpenWorkflowStatus", () => {
  it("prefers the backlog status", () => {
    const backlog = status("b", "backlog", false);

    expect(findOpenWorkflowStatus([status("a", "todo", false), backlog])).toBe(
      backlog,
    );
  });

  it("falls back to the first status that is not done", () => {
    const todo = status("a", "todo", false);

    expect(findOpenWorkflowStatus([status("d", "done", true), todo])).toBe(
      todo,
    );
  });

  it("finds nothing among done statuses", () => {
    expect(findOpenWorkflowStatus([status("d", "done", true)])).toBeUndefined();
  });
});

describe("resolvePulledStatusId", () => {
  const statuses = [
    status("backlog", "backlog", false),
    status("done", "done", true),
  ];

  it("moves an active task to done when the issue closed", () => {
    expect(
      resolvePulledStatusId(item(), remoteIssue({ state: "closed" }), statuses),
    ).toBe("done");
  });

  it("keeps archived and already done tasks when the issue closed", () => {
    const closed = remoteIssue({ state: "closed" });

    expect(
      resolvePulledStatusId(
        item({ archivedAt: "2026-01-01" }),
        closed,
        statuses,
      ),
    ).toBe("status-current");
    expect(
      resolvePulledStatusId(item({ isDone: true }), closed, statuses),
    ).toBe("status-current");
  });

  it("keeps the status when no done status exists", () => {
    expect(
      resolvePulledStatusId(item(), remoteIssue({ state: "closed" }), [
        status("backlog", "backlog", false),
      ]),
    ).toBe("status-current");
  });

  it("reopens a done task into the open status", () => {
    expect(
      resolvePulledStatusId(item({ isDone: true }), remoteIssue(), statuses),
    ).toBe("backlog");
  });

  it("keeps the status when reopening finds no open status", () => {
    expect(
      resolvePulledStatusId(item({ isDone: true }), remoteIssue(), [
        status("done", "done", true),
      ]),
    ).toBe("status-current");
  });

  it("keeps the status of an open task with an open issue", () => {
    expect(resolvePulledStatusId(item(), remoteIssue(), statuses)).toBe(
      "status-current",
    );
  });
});
