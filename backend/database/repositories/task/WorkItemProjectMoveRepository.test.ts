import { describe, expect, it, vi } from "vitest";

import { WorkItemProjectMoveRepository } from "./WorkItemProjectMoveRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";
import type {
  ConditionalWorkItemMove,
  WorkItemMove,
} from "./WorkItemProjectMoveRepository";

const MOVE: WorkItemMove = {
  projectId: "target",
  key: "T-1",
  number: 1,
  parentId: null,
  milestoneId: null,
  assigneeId: null,
};

function conditional(id: string): ConditionalWorkItemMove {
  return {
    id,
    move: MOVE,
    expected: {
      projectId: "source",
      githubIssueNumber: 4,
      fields: {
        title: "t",
        statusId: "s",
        priority: "normal",
        assigneeId: null,
        assigneeGroupId: null,
        reporterId: "r",
        parentId: null,
        milestoneId: null,
        dueAt: null,
        startAt: null,
      },
    },
  };
}

/** A database whose transaction runs on a scope answering from the given queues. */
function databaseOf(
  subtreeRows: DatabaseValue[][],
  updateResults: DatabaseValue[][][],
): {
  readonly database: TaskDatabase;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  query.mockResolvedValueOnce(subtreeRows);
  for (const rows of updateResults) query.mockResolvedValueOnce(rows);
  const database = {
    query,
    transaction: async (work: (scope: unknown) => Promise<unknown>) =>
      work({ query }),
  } as unknown as TaskDatabase;
  return { database, query };
}

describe("WorkItemProjectMoveRepository.moveToProject", () => {
  it("writes the move without a comparison", async () => {
    const query = vi.fn(async () => [["w"]]);
    const database = { query } as unknown as TaskDatabase;

    await new WorkItemProjectMoveRepository(database).moveToProject("w", MOVE);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE work_items"),
      expect.objectContaining({
        id: "w",
        has_expected: false,
        base_project_id: null,
        base_github_issue_number: null,
      }),
    );
  });
});

describe("WorkItemProjectMoveRepository.moveSubtreeIfCurrent", () => {
  it("moves the whole subtree when everything matches", async () => {
    const { database, query } = databaseOf([["a"], ["b"]], [[["a"]], [["b"]]]);

    await expect(
      new WorkItemProjectMoveRepository(database).moveSubtreeIfCurrent("a", [
        conditional("a"),
        conditional("b"),
      ]),
    ).resolves.toBe(true);
    expect(query).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        id: "b",
        has_expected: true,
        base_project_id: "source",
        base_github_issue_number: 4,
      }),
    );
  });

  it("reports a conflict when the subtree has a different size", async () => {
    const { database } = databaseOf([["a"], ["b"]], []);

    await expect(
      new WorkItemProjectMoveRepository(database).moveSubtreeIfCurrent("a", [
        conditional("a"),
      ]),
    ).resolves.toBe(false);
  });

  it("reports a conflict when the subtree holds an unexpected item", async () => {
    const { database } = databaseOf([["c"]], []);

    await expect(
      new WorkItemProjectMoveRepository(database).moveSubtreeIfCurrent("a", [
        conditional("a"),
      ]),
    ).resolves.toBe(false);
  });

  it("reports a conflict when an identifier is not text", async () => {
    const { database } = databaseOf([[1]], []);

    await expect(
      new WorkItemProjectMoveRepository(database).moveSubtreeIfCurrent("a", [
        conditional("a"),
      ]),
    ).resolves.toBe(false);
  });

  it("reports a conflict when a source row changed", async () => {
    const { database } = databaseOf([["a"]], [[]]);

    await expect(
      new WorkItemProjectMoveRepository(database).moveSubtreeIfCurrent("a", [
        conditional("a"),
      ]),
    ).resolves.toBe(false);
  });

  it("passes other failures on", async () => {
    const database = {
      transaction: async () => {
        throw new Error("boom");
      },
    } as unknown as TaskDatabase;

    await expect(
      new WorkItemProjectMoveRepository(database).moveSubtreeIfCurrent("a", []),
    ).rejects.toThrow("boom");
  });
});
