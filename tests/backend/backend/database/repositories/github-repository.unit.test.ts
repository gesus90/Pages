import { beforeEach, expect, it, vi } from "vitest";

import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";

const query = vi.fn();
const execute = vi.fn();
const repository = new GitHubRepository(partial<Database>({ query, execute }));
const issue = [
  "issue",
  "project",
  42,
  "Title",
  "https://example.com/42",
  "open",
  0,
  null,
  "detected",
  "updated",
];
const pull = [
  "pull",
  "project",
  7,
  "Change",
  "https://example.com/7",
  "open",
  0,
  "branch",
  null,
  null,
  "synced",
];

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
});

it("reads external issue metadata with the requested dismissal scope", async () => {
  query.mockResolvedValue([issue]);
  expect(await repository.findExternalIssues("project", true)).toMatchObject([
    { id: "issue", projectId: "project", issueNumber: 42, dismissed: false },
  ]);
  expect(query).toHaveBeenCalledWith(expect.any(String), {
    project_id: "project",
    include_dismissed: 1,
  });
  expect(
    (await repository.findExternalIssuesByProjectIds(["project"])).get(
      "project",
    ),
  ).toHaveLength(1);
  query.mockClear();
  expect((await repository.findExternalIssuesByProjectIds([])).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("rejects invalid stored issue and pull request fields", async () => {
  query.mockResolvedValueOnce([
    [...issue.slice(0, 5), "unknown", ...issue.slice(6)],
  ]);
  await expect(repository.findExternalIssueById("issue")).rejects.toThrow();
  query.mockResolvedValueOnce([[...issue.slice(0, 7), 42, ...issue.slice(8)]]);
  await expect(
    repository.findExternalIssueByNumber("project", 42),
  ).rejects.toThrow();
  query.mockResolvedValueOnce([
    [...pull.slice(0, 5), "unknown", ...pull.slice(6)],
  ]);
  await expect(repository.findPullRequestById("pull")).rejects.toThrow();
});

it("reads pull requests and returns no data for an empty project scope", async () => {
  query.mockResolvedValue([pull]);
  expect(await repository.findPullRequestsByProject("project")).toMatchObject([
    { id: "pull", number: 7, merged: false, branch: "branch" },
  ]);
  expect(
    (await repository.findPullRequestsByProjectIds(["project"])).get("project"),
  ).toHaveLength(1);
  query.mockClear();
  expect((await repository.findPullRequestsByProjectIds([])).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("binds issue upserts and import assignments", async () => {
  await repository.upsertExternalIssue({
    id: "issue",
    projectId: "project",
    issueNumber: 42,
    title: "Title",
    url: "https://example.com/42",
    state: "open",
  });
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("ON CONFLICT"),
    expect.objectContaining({ id: "issue", issue_number: 42 }),
  );
  await repository.markExternalIssueImported("issue", "ticket");
  expect(execute).toHaveBeenLastCalledWith(expect.any(String), {
    id: "issue",
    work_item_id: "ticket",
  });
});
