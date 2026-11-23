import { describe, expect, it, vi } from "vitest";

import { WorkItemWriteRepository } from "./WorkItemWriteRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";
import type { WorkItemUpdate } from "./WorkItemWriteRepository";

function databaseOf(rows: DatabaseValue[][] = [["w"]]): {
  readonly repository: WorkItemWriteRepository;
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => {});
  return {
    repository: new WorkItemWriteRepository({
      query,
      execute,
    } as unknown as TaskDatabase),
    query,
    execute,
  };
}

const UPDATE: WorkItemUpdate = {
  title: "T",
  description: "D",
  statusId: "s",
  priority: "low",
  assigneeId: null,
  assigneeGroupId: null,
  reporterId: "r",
  parentId: null,
  milestoneId: null,
  dueAt: null,
  startAt: null,
};

function lastParameters(
  mock: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  return mock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
}

describe("WorkItemWriteRepository text form", () => {
  it("returns the text of the stored form", async () => {
    const { repository } = databaseOf();

    await expect(repository.storedTextForm("plain")).resolves.toBe("plain");
  });
});

describe("WorkItemWriteRepository GitHub state", () => {
  it("replaces the link", async () => {
    const { repository, execute } = databaseOf();

    await repository.updateGitHubLink("w", {
      issueNumber: 1,
      issueUrl: "u",
      issueState: "open",
      issueUpdatedAt: "t",
      contentHash: "h",
      conflict: true,
      lastSyncAt: "s",
    });

    expect(lastParameters(execute)).toMatchObject({
      id: "w",
      github_conflict: 1,
      github_issue_number: 1,
    });
  });

  it("stores a link without conflict", async () => {
    const { repository, execute } = databaseOf();

    await repository.updateGitHubLink("w", {
      issueNumber: null,
      issueUrl: null,
      issueState: null,
      issueUpdatedAt: null,
      contentHash: null,
      conflict: false,
      lastSyncAt: null,
    });

    expect(lastParameters(execute)).toMatchObject({
      github_conflict: 0,
      github_issue_number: null,
    });
  });

  it.each([
    [true, 1],
    [false, 0],
  ])("sets the conflict flag %s", async (conflict, stored) => {
    const { repository, execute } = databaseOf();

    await repository.setGitHubConflict("w", conflict);

    expect(lastParameters(execute)).toEqual({
      id: "w",
      github_conflict: stored,
    });
  });

  it("stores the last error", async () => {
    const { repository, execute } = databaseOf();

    await repository.setGitHubError("w", "bad");

    expect(lastParameters(execute)).toEqual({
      id: "w",
      github_last_error: "bad",
    });
  });

  it("writes the synchronized fields", async () => {
    const { repository, execute } = databaseOf();

    await repository.updateFromGitHub("w", {
      title: "t",
      description: "d",
      statusId: "s",
    });

    expect(lastParameters(execute)).toEqual({
      id: "w",
      title: "t",
      description: "d",
      status_id: "s",
    });
  });
});

describe("WorkItemWriteRepository inserts and moves", () => {
  it("inserts a work item", async () => {
    const { repository, execute } = databaseOf();

    await repository.insert({
      id: "w",
      projectId: "p",
      departmentIds: [],
      key: "K-1",
      number: 1,
      type: "task",
      parentId: null,
      title: "T",
      description: "D",
      statusId: "s",
      priority: "low",
      assigneeId: null,
      assigneeGroupId: null,
      createdBy: "c",
      milestoneId: null,
      dueAt: null,
      startAt: null,
      sortOrder: 2,
    });

    expect(lastParameters(execute)).toMatchObject({
      id: "w",
      project_id: "p",
      sort_order: 2,
      created_by: "c",
    });
  });

  it("sets the parent", async () => {
    const { repository, execute } = databaseOf();

    await repository.updateParent("w", "p");

    expect(lastParameters(execute)).toEqual({ id: "w", parent_id: "p" });
  });

  it.each([
    [true, 1],
    [false, 0],
  ])("updates status and order with done=%s", async (isDone, stored) => {
    const { repository, execute } = databaseOf();

    await repository.updateStatusAndOrder("w", "s", 5, isDone);

    expect(lastParameters(execute)).toEqual({
      id: "w",
      is_done: stored,
      sort_order: 5,
      status_id: "s",
    });
  });
});

describe("WorkItemWriteRepository conditional updates", () => {
  it("updates all fields and reports the change", async () => {
    const { repository, query } = databaseOf();

    await expect(repository.update("w", UPDATE)).resolves.toBe(true);
    expect(lastParameters(query)).toMatchObject({
      description: "D",
      new_description: "D",
      saved_description: "D",
      base_description: null,
      has_expected: false,
    });
  });

  it("keeps the description and compares the snapshot", async () => {
    const { repository, query } = databaseOf([]);

    await expect(
      repository.update("w", {
        ...UPDATE,
        shouldPreserveDescription: true,
        baseDescription: "B",
        expected: {
          title: "t",
          statusId: "s",
          priority: "low",
          assigneeId: null,
          assigneeGroupId: null,
          reporterId: "r",
          parentId: null,
          milestoneId: null,
          dueAt: null,
          startAt: null,
        },
      }),
    ).resolves.toBe(false);
    expect(lastParameters(query)).toMatchObject({
      description: null,
      new_description: null,
      saved_description: null,
      base_description: "B",
      has_expected: true,
    });
  });

  it("compares a description that would lose its NUL character", async () => {
    const { repository, query } = databaseOf();

    await repository.update("w", { ...UPDATE, description: "1\u0000" });
    expect(lastParameters(query)).toMatchObject({
      saved_description: "1\u0000",
    });

    await repository.updateDescription("w", "a\u0000b", "base");
    expect(lastParameters(query)).toMatchObject({ saved_description: "ab" });
  });

  it("replaces a description", async () => {
    const { repository, query } = databaseOf();

    await expect(repository.updateDescription("w", "n", "b")).resolves.toBe(
      true,
    );
    expect(lastParameters(query)).toEqual({
      base_description: "b",
      description: "n",
      id: "w",
      new_description: "n",
      saved_description: "n",
    });
  });

  it("replaces a title", async () => {
    const { repository, query } = databaseOf([]);

    await expect(repository.updateTitle("w", "n", "b")).resolves.toBe(false);
    expect(lastParameters(query)).toEqual({
      base_title: "b",
      id: "w",
      title: "n",
    });
  });

  it.each([
    [true, 1],
    [false, 0],
  ])("replaces the status with done=%s", async (isDone, stored) => {
    const { repository, query } = databaseOf();

    await expect(
      repository.updateStatus("w", { id: "s", isDone }, "base"),
    ).resolves.toBe(true);
    expect(lastParameters(query)).toEqual({
      base_status_id: "base",
      id: "w",
      is_done: stored,
      status_id: "s",
    });
  });

  it("replaces the parent", async () => {
    const { repository, query } = databaseOf();

    await expect(repository.replaceParent("w", "p", null)).resolves.toBe(true);
    expect(lastParameters(query)).toEqual({
      base_parent_id: null,
      id: "w",
      parent_id: "p",
    });
  });
});
