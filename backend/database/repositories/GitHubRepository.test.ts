import { describe, expect, it, vi } from "vitest";

import { GitHubRepository } from "./GitHubRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

type Row = DatabaseValue[];

const ISSUE_ROW: Row = [
  "i1",
  "p1",
  7,
  "Bug",
  "https://example.test/7",
  "open",
  0,
  null,
  "2026-01-01",
  "2026-01-02",
];

const PULL_ROW: Row = [
  "r1",
  "p1",
  3,
  "Fix",
  "https://example.test/3",
  "closed",
  1,
  "feature",
  "w1",
  "ABC-1",
  "2026-02-01",
];

function doubleOf(rows: Row[] = []): {
  repository: GitHubRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  const database = { query, execute } as unknown as Database;
  return { repository: new GitHubRepository(database), query, execute };
}

function parametersOf(call: ReturnType<typeof vi.fn>): unknown {
  return call.mock.calls[0]?.[1];
}

function sqlOf(call: ReturnType<typeof vi.fn>): string {
  return String(call.mock.calls[0]?.[0]);
}

const MAPPED_ISSUE = {
  detectedAt: "2026-01-01",
  dismissed: false,
  id: "i1",
  importedWorkItemId: null,
  issueNumber: 7,
  projectId: "p1",
  state: "open",
  title: "Bug",
  updatedAt: "2026-01-02",
  url: "https://example.test/7",
};

const MAPPED_PULL = {
  branch: "feature",
  id: "r1",
  merged: true,
  number: 3,
  projectId: "p1",
  state: "closed",
  syncedAt: "2026-02-01",
  title: "Fix",
  url: "https://example.test/3",
  workItemId: "w1",
  workItemKey: "ABC-1",
};

describe("external issue reads", () => {
  it("maps the issues of a project and hides dismissed ones", async () => {
    const { repository, query } = doubleOf([ISSUE_ROW]);

    await expect(repository.findExternalIssues("p1")).resolves.toEqual([
      MAPPED_ISSUE,
    ]);
    expect(parametersOf(query)).toEqual({
      project_id: "p1",
      include_dismissed: 0,
    });
  });

  it("includes dismissed issues on request", async () => {
    const { repository, query } = doubleOf([]);

    await repository.findExternalIssues("p1", true);

    expect(parametersOf(query)).toEqual({
      project_id: "p1",
      include_dismissed: 1,
    });
  });

  it("returns an empty map without querying for no projects", async () => {
    const { repository, query } = doubleOf();

    const result = await repository.findExternalIssuesByProjectIds([]);

    expect(result.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("groups issues by project", async () => {
    const other: Row = [...ISSUE_ROW];
    other[0] = "i2";
    other[2] = 6;
    const third: Row = [...ISSUE_ROW];
    third[0] = "i3";
    third[1] = "p2";
    const { repository, query } = doubleOf([ISSUE_ROW, other, third]);

    const result = await repository.findExternalIssuesByProjectIds(
      ["p1", "p2"],
      true,
    );

    expect(result.get("p1")?.map((issue) => issue.id)).toEqual(["i1", "i2"]);
    expect(result.get("p2")?.map((issue) => issue.id)).toEqual(["i3"]);
    expect(parametersOf(query)).toEqual({
      include_dismissed: 1,
      issue_project_id_0: "p1",
      issue_project_id_1: "p2",
    });
    expect(sqlOf(query)).toContain("$issue_project_id_0, $issue_project_id_1");
  });

  it("defaults to hiding dismissed issues for several projects", async () => {
    const { repository, query } = doubleOf();

    await repository.findExternalIssuesByProjectIds(["p1"]);

    expect(parametersOf(query)).toMatchObject({ include_dismissed: 0 });
  });
});

describe("external issue lookups", () => {
  it("finds an issue by identifier or returns null", async () => {
    const found = doubleOf([ISSUE_ROW]);
    await expect(found.repository.findExternalIssueById("i1")).resolves.toEqual(
      MAPPED_ISSUE,
    );
    expect(parametersOf(found.query)).toEqual({ id: "i1" });

    const missing = doubleOf();
    await expect(
      missing.repository.findExternalIssueById("x"),
    ).resolves.toBeNull();
  });

  it("finds an issue by project and number or returns null", async () => {
    const found = doubleOf([ISSUE_ROW]);
    await expect(
      found.repository.findExternalIssueByNumber("p1", 7),
    ).resolves.toEqual(MAPPED_ISSUE);
    expect(parametersOf(found.query)).toEqual({
      project_id: "p1",
      issue_number: 7,
    });

    const missing = doubleOf();
    await expect(
      missing.repository.findExternalIssueByNumber("p1", 8),
    ).resolves.toBeNull();
  });

  it("maps dismissed and imported issues", async () => {
    const row: Row = [...ISSUE_ROW];
    row[5] = "closed";
    row[6] = 1;
    row[7] = "w9";
    const { repository } = doubleOf([row]);

    await expect(repository.findExternalIssueById("i1")).resolves.toMatchObject(
      { state: "closed", dismissed: true, importedWorkItemId: "w9" },
    );
  });

  it("rejects an unsupported issue state", async () => {
    const row: Row = [...ISSUE_ROW];
    row[5] = "draft";
    const { repository } = doubleOf([row]);

    await expect(repository.findExternalIssueById("i1")).rejects.toThrow(
      'unsupported external issue state "draft"',
    );
  });

  it("rejects an invalid imported work item value", async () => {
    const row: Row = [...ISSUE_ROW];
    row[7] = 5;
    const { repository } = doubleOf([row]);

    await expect(repository.findExternalIssueById("i1")).rejects.toThrow(
      '"imported_work_item_id"',
    );
  });
});

describe("external issue writes", () => {
  it("upserts an issue with its remote metadata", async () => {
    const { repository, execute } = doubleOf();

    await repository.upsertExternalIssue({
      id: "i1",
      projectId: "p1",
      issueNumber: 7,
      title: "Bug",
      url: "u",
      state: "open",
    });

    expect(parametersOf(execute)).toEqual({
      id: "i1",
      project_id: "p1",
      issue_number: 7,
      title: "Bug",
      url: "u",
      state: "open",
    });
  });

  it("updates the remote metadata of an issue", async () => {
    const { repository, execute } = doubleOf();

    await repository.updateExternalIssue("i1", {
      title: "T",
      url: "u",
      state: "closed",
    });

    expect(parametersOf(execute)).toEqual({
      id: "i1",
      title: "T",
      url: "u",
      state: "closed",
    });
  });

  it("dismisses, imports and deletes an issue", async () => {
    const { repository, execute } = doubleOf();

    await repository.dismissExternalIssue("i1");
    await repository.markExternalIssueImported("i1", "w1");
    await repository.deleteExternalIssue("i1");

    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      { id: "i1" },
      { id: "i1", work_item_id: "w1" },
      { id: "i1" },
    ]);
  });
});

describe("pull request reads", () => {
  it("maps the pull requests of a project without a scope", async () => {
    const { repository, query } = doubleOf([PULL_ROW]);

    await expect(repository.findPullRequestsByProject("p1")).resolves.toEqual([
      MAPPED_PULL,
    ]);
    expect(parametersOf(query)).toEqual({ project_id: "p1" });
    expect(sqlOf(query)).toContain("1 = 1");
  });

  it("applies department scope without a project list", async () => {
    const { repository, query } = doubleOf();

    await repository.findPullRequestsByProject("p1", {
      departmentIds: ["d1"],
    });

    expect(parametersOf(query)).toMatchObject({
      project_id: "p1",
      visible_department_id_0: "d1",
    });
    expect(sqlOf(query)).not.toContain("pull_scope_project");
  });

  it("limits the pull requests to accessible projects", async () => {
    const { repository, query } = doubleOf();

    await repository.findPullRequestsByProject("p1", {
      departmentIds: null,
      projectIds: ["p1", "p2"],
    });

    expect(parametersOf(query)).toMatchObject({
      pull_scope_project_0: "p1",
      pull_scope_project_1: "p2",
    });
    expect(sqlOf(query)).toContain("github_pull_requests.project_id IN (");
  });

  it("denies everything for an empty project scope", async () => {
    const { repository, query } = doubleOf([PULL_ROW]);

    await expect(
      repository.findPullRequestsByWorkItem("w1", {
        departmentIds: null,
        projectIds: [],
      }),
    ).resolves.toEqual([MAPPED_PULL]);

    expect(parametersOf(query)).toEqual({ work_item_id: "w1" });
    expect(sqlOf(query)).toContain("1 = 0");
  });
});

describe("pull request group reads", () => {
  it("returns an empty map without querying for no projects", async () => {
    const { repository, query } = doubleOf();

    const result = await repository.findPullRequestsByProjectIds([]);

    expect(result.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("groups pull requests by project", async () => {
    const second: Row = [...PULL_ROW];
    second[0] = "r2";
    const third: Row = [...PULL_ROW];
    third[0] = "r3";
    third[1] = "p2";
    const { repository, query } = doubleOf([PULL_ROW, second, third]);

    const result = await repository.findPullRequestsByProjectIds(["p1", "p2"], {
      departmentIds: ["d1"],
    });

    expect(result.get("p1")?.map((pull) => pull.id)).toEqual(["r1", "r2"]);
    expect(result.get("p2")?.map((pull) => pull.id)).toEqual(["r3"]);
    expect(parametersOf(query)).toMatchObject({
      pull_request_project_id_0: "p1",
      pull_request_project_id_1: "p2",
      visible_department_id_0: "d1",
    });
  });

  it("finds a pull request by identifier or returns null", async () => {
    const found = doubleOf([PULL_ROW]);
    await expect(found.repository.findPullRequestById("r1")).resolves.toEqual(
      MAPPED_PULL,
    );
    expect(parametersOf(found.query)).toEqual({ id: "r1" });

    const missing = doubleOf();
    await expect(
      missing.repository.findPullRequestById("x"),
    ).resolves.toBeNull();
  });

  it("maps an open pull request without assignment or branch", async () => {
    const row: Row = [...PULL_ROW];
    row[5] = "open";
    row[6] = 0;
    row[7] = null;
    row[8] = null;
    row[9] = null;
    const { repository } = doubleOf([row]);

    await expect(repository.findPullRequestById("r1")).resolves.toMatchObject({
      state: "open",
      merged: false,
      branch: null,
      workItemId: null,
      workItemKey: null,
    });
  });

  it.each([
    [5, "draft", 'unsupported pull request state "draft"'],
    [7, 4, '"branch"'],
    [8, 4, '"work_item_id"'],
    [9, 4, '"work_item_key"'],
  ])("rejects an invalid value in column %i", async (index, value, message) => {
    const row: Row = [...PULL_ROW];
    row[index] = value;
    const { repository } = doubleOf([row]);

    await expect(repository.findPullRequestById("r1")).rejects.toThrow(message);
  });
});

describe("pull request writes", () => {
  it.each([
    [true, 1],
    [false, 0],
  ])("upserts with merged=%s and reports changes", async (merged, stored) => {
    const { repository, query } = doubleOf([["r1"]]);

    const changed = await repository.upsertPullRequest({
      id: "r1",
      projectId: "p1",
      number: 3,
      title: "Fix",
      url: "u",
      state: "open",
      merged,
      branch: null,
    });

    expect(changed).toBe(true);
    expect(parametersOf(query)).toMatchObject({ merged: stored, branch: null });
  });

  it("reports an unchanged pull request", async () => {
    const { repository } = doubleOf([]);

    await expect(
      repository.upsertPullRequest({
        id: "r1",
        projectId: "p1",
        number: 3,
        title: "Fix",
        url: "u",
        state: "closed",
        merged: true,
        branch: "b",
      }),
    ).resolves.toBe(false);
  });

  it("assigns and clears the work item of a pull request", async () => {
    const { repository, execute } = doubleOf();

    await repository.assignPullRequest("r1", "w1");
    await repository.assignPullRequest("r1", null);

    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      { id: "r1", work_item_id: "w1" },
      { id: "r1", work_item_id: null },
    ]);
  });
});
