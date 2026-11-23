import { describe, expect, it, vi } from "vitest";

import { WorkItemHistoryRepository } from "./WorkItemHistoryRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: TaskDatabase;
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => {});
  return {
    database: { query, execute } as unknown as TaskDatabase,
    query,
    execute,
  };
}

const ROW: DatabaseValue[] = [
  "h1",
  "w1",
  "u1",
  null,
  "update",
  "title",
  "a",
  "b",
  "now",
];

describe("WorkItemHistoryRepository", () => {
  it("lists the history of a project within the visibility", async () => {
    const { database, query } = databaseOf([ROW]);

    const result = await new WorkItemHistoryRepository(
      database,
    ).findByProjectId("p", {
      departmentIds: ["d"],
    });

    expect(result).toEqual([
      {
        action: "update",
        createdAt: "now",
        field: "title",
        id: "h1",
        newValue: "b",
        oldValue: "a",
        userDisplayName: null,
        userId: "u1",
        workItemId: "w1",
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      project_id: "p",
      visible_department_id_0: "d",
    });
  });

  it("lists the history of a project without visibility", async () => {
    const { database, query } = databaseOf([]);

    await expect(
      new WorkItemHistoryRepository(database).findByProjectId("p"),
    ).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(expect.any(String), { project_id: "p" });
  });

  it("lists the history of a work item", async () => {
    const { database, query } = databaseOf([ROW]);

    await expect(
      new WorkItemHistoryRepository(database).findByWorkItemId("w1"),
    ).resolves.toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      work_item_id: "w1",
    });
  });

  it("records an entry", async () => {
    const { database, execute } = databaseOf([]);

    await new WorkItemHistoryRepository(database).insert({
      id: "h",
      workItemId: "w",
      userId: "u",
      action: "create",
      field: null,
      oldValue: null,
      newValue: "x",
    });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO work_item_history"),
      {
        action: "create",
        field: null,
        id: "h",
        new_value: "x",
        old_value: null,
        user_id: "u",
        work_item_id: "w",
      },
    );
  });
});
