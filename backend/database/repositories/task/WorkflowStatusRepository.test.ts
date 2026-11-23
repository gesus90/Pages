import { describe, expect, it, vi } from "vitest";

import { WorkflowStatusRepository } from "./WorkflowStatusRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: TaskDatabase;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  return { database: { query } as unknown as TaskDatabase, query };
}

const ROW: DatabaseValue[] = ["s1", null, "todo", "To do", 2, 0];

describe("WorkflowStatusRepository", () => {
  it("maps all statuses", async () => {
    const { database } = databaseOf([ROW, ["s2", "p1", "done", "Done", 3, 1]]);

    await expect(
      new WorkflowStatusRepository(database).findAll(),
    ).resolves.toEqual([
      {
        id: "s1",
        isDone: false,
        key: "todo",
        name: "To do",
        position: 2,
        projectId: null,
      },
      {
        id: "s2",
        isDone: true,
        key: "done",
        name: "Done",
        position: 3,
        projectId: "p1",
      },
    ]);
  });

  it("finds a status by identifier", async () => {
    const { database, query } = databaseOf([ROW]);

    await expect(
      new WorkflowStatusRepository(database).findById("s1"),
    ).resolves.toMatchObject({ id: "s1" });
    expect(query).toHaveBeenCalledWith(expect.any(String), { id: "s1" });
  });

  it("returns null for an unknown identifier", async () => {
    const { database } = databaseOf([]);

    await expect(
      new WorkflowStatusRepository(database).findById("x"),
    ).resolves.toBeNull();
  });
});
