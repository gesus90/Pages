import { beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";

import type { Database } from "@/backend/database/Database";

function createDatabase(): Database & {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    migrate: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
  } as unknown as Database & {
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

function createExternalRow(): unknown[] {
  return [
    "external-1",
    "project-1",
    104,
    "Mobile Navigation funktioniert nicht",
    "https://github.com/user/pages/issues/104",
    "open",
    0,
    null,
    "2026-09-05T14:21:00.000Z",
    "2026-09-05T14:21:00.000Z",
  ];
}

function createPullRequestRow(): unknown[] {
  return [
    "pr-1",
    "project-1",
    91,
    "GitHub Sync",
    "https://github.com/user/pages/pull/91",
    "open",
    0,
    "feature/github-sync",
    "item-1",
    "PAGE-42",
    "2026-09-05T14:21:00.000Z",
  ];
}

describe("GitHubRepository", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: GitHubRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new GitHubRepository(database);
  });

  it("lists open external issues while hiding dismissed and imported ones", async () => {
    database.query.mockResolvedValue([createExternalRow()]);

    const issues = await repository.findExternalIssues("project-1");

    expect(issues).toEqual([
      expect.objectContaining({ issueNumber: 104, dismissed: false }),
    ]);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("imported_work_item_id IS NULL"),
      { project_id: "project-1", include_dismissed: 0 },
    );

    await repository.findExternalIssues("project-1", true);
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("imported_work_item_id IS NULL"),
      { project_id: "project-1", include_dismissed: 1 },
    );
  });

  it("finds external issues by id or remote number", async () => {
    database.query
      .mockResolvedValueOnce([createExternalRow()])
      .mockResolvedValueOnce([]);

    await expect(
      repository.findExternalIssueById("external-1"),
    ).resolves.toMatchObject({ id: "external-1" });
    await expect(
      repository.findExternalIssueById("missing"),
    ).resolves.toBeNull();

    database.query
      .mockResolvedValueOnce([createExternalRow()])
      .mockResolvedValueOnce([]);

    await expect(
      repository.findExternalIssueByNumber("project-1", 104),
    ).resolves.toMatchObject({ issueNumber: 104 });
    await expect(
      repository.findExternalIssueByNumber("project-1", 999),
    ).resolves.toBeNull();
  });

  it("inserts, refreshes, dismisses, imports, and deletes external issues", async () => {
    await repository.upsertExternalIssue({
      id: "external-1",
      issueNumber: 104,
      projectId: "project-1",
      state: "open",
      title: "Mobile Navigation funktioniert nicht",
      url: "https://github.com/user/pages/issues/104",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO github_external_issues"),
      expect.objectContaining({ issue_number: 104 }),
    );

    await repository.updateExternalIssue("external-1", {
      state: "closed",
      title: "Mobile Navigation funktioniert nicht",
      url: "https://github.com/user/pages/issues/104",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("state = $state"),
      expect.objectContaining({ state: "closed" }),
    );

    await repository.dismissExternalIssue("external-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("dismissed = 1"),
      { id: "external-1" },
    );

    await repository.markExternalIssueImported("external-1", "item-9");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("imported_work_item_id"),
      { id: "external-1", work_item_id: "item-9" },
    );

    await repository.deleteExternalIssue("external-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM github_external_issues"),
      { id: "external-1" },
    );
  });

  it("rejects external issues with invalid stored values", async () => {
    const invalidState = createExternalRow();
    invalidState[5] = "weird";
    database.query.mockResolvedValue([invalidState]);

    await expect(repository.findExternalIssues("project-1")).rejects.toThrow(
      'unsupported external issue state "weird"',
    );

    const invalidImport = createExternalRow();
    invalidImport[7] = 42;
    database.query.mockResolvedValue([invalidImport]);

    await expect(repository.findExternalIssues("project-1")).rejects.toThrow(
      'invalid value for "imported_work_item_id"',
    );
  });

  it("lists pull requests by project, task, or id", async () => {
    database.query.mockResolvedValue([createPullRequestRow()]);

    await expect(
      repository.findPullRequestsByProject("project-1"),
    ).resolves.toEqual([
      expect.objectContaining({ number: 91, workItemKey: "PAGE-42" }),
    ]);

    await expect(
      repository.findPullRequestsByWorkItem("item-1"),
    ).resolves.toHaveLength(1);

    database.query
      .mockResolvedValueOnce([createPullRequestRow()])
      .mockResolvedValueOnce([]);

    await expect(repository.findPullRequestById("pr-1")).resolves.toMatchObject(
      { id: "pr-1" },
    );
    await expect(repository.findPullRequestById("missing")).resolves.toBeNull();
  });

  it("inserts pull requests while keeping assignments", async () => {
    await repository.upsertPullRequest({
      branch: "feature/github-sync",
      id: "pr-1",
      merged: false,
      number: 91,
      projectId: "project-1",
      state: "open",
      title: "GitHub Sync",
      url: "https://github.com/user/pages/pull/91",
    });

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO github_pull_requests"),
      expect.objectContaining({ merged: 0, number: 91 }),
    );

    await repository.upsertPullRequest({
      branch: null,
      id: "pr-2",
      merged: true,
      number: 90,
      projectId: "project-1",
      state: "closed",
      title: "Old work",
      url: "https://github.com/user/pages/pull/90",
    });

    expect(database.execute).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO github_pull_requests"),
      expect.objectContaining({ merged: 1, number: 90 }),
    );

    await repository.assignPullRequest("pr-1", "item-1");
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("work_item_id = $work_item_id"),
      { id: "pr-1", work_item_id: "item-1" },
    );

    await repository.assignPullRequest("pr-1", null);
    expect(database.execute).toHaveBeenLastCalledWith(
      expect.stringContaining("work_item_id = $work_item_id"),
      { id: "pr-1", work_item_id: null },
    );
  });

  it("rejects pull requests with invalid stored values", async () => {
    const invalidState = createPullRequestRow();
    invalidState[5] = "weird";
    database.query.mockResolvedValue([invalidState]);

    await expect(
      repository.findPullRequestsByProject("project-1"),
    ).rejects.toThrow('unsupported pull request state "weird"');

    const invalidBranch = createPullRequestRow();
    invalidBranch[7] = 42;
    database.query.mockResolvedValue([invalidBranch]);

    await expect(
      repository.findPullRequestsByProject("project-1"),
    ).rejects.toThrow('invalid value for "branch"');

    const invalidWorkItem = createPullRequestRow();
    invalidWorkItem[8] = 42;
    database.query.mockResolvedValue([invalidWorkItem]);

    await expect(
      repository.findPullRequestsByProject("project-1"),
    ).rejects.toThrow('invalid value for "work_item_id"');

    const invalidKey = createPullRequestRow();
    invalidKey[9] = 42;
    database.query.mockResolvedValue([invalidKey]);

    await expect(
      repository.findPullRequestsByProject("project-1"),
    ).rejects.toThrow('invalid value for "work_item_key"');
  });

  it("groups external issues by project including dismissed lookups", async () => {
    await expect(
      repository.findExternalIssuesByProjectIds([]),
    ).resolves.toEqual(new Map());

    database.query.mockResolvedValue([
      createExternalRow(),
      [
        "external-2",
        "project-1",
        103,
        "Second issue",
        "https://github.com/user/pages/issues/103",
        "open",
        0,
        null,
        "2026-09-05T14:21:00.000Z",
        "2026-09-05T14:21:00.000Z",
      ],
    ]);

    const issues = await repository.findExternalIssuesByProjectIds(
      ["project-1"],
      true,
    );

    expect(issues.get("project-1")).toHaveLength(2);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("project_id IN"),
      expect.objectContaining({
        include_dismissed: 1,
        issue_project_id_0: "project-1",
      }),
    );
  });

  it("groups pull requests by project", async () => {
    await expect(repository.findPullRequestsByProjectIds([])).resolves.toEqual(
      new Map(),
    );

    database.query.mockResolvedValue([
      createPullRequestRow(),
      [
        "pr-2",
        "project-1",
        90,
        "Second PR",
        "https://github.com/user/pages/pull/90",
        "open",
        0,
        null,
        "item-1",
        "PAGE-42",
        "2026-09-05T14:21:00.000Z",
      ],
    ]);

    const pullRequests = await repository.findPullRequestsByProjectIds([
      "project-1",
    ]);

    expect(pullRequests.get("project-1")).toHaveLength(2);
  });
});
