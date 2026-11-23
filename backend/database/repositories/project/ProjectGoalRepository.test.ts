import { expect, it, vi, type Mock } from "vitest";

import { ProjectGoalRepository } from "./ProjectGoalRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  return { database: { execute, query: async () => rows }, execute };
}

it("maps goal rows", async () => {
  const { database } = databaseOf([["g1", "p1", "Ship", 1, 2n]]);
  await expect(
    new ProjectGoalRepository(database).findByProjectId("p1"),
  ).resolves.toEqual([
    { id: "g1", projectId: "p1", title: "Ship", isDone: true, position: 2 },
  ]);
});

it("rejects a goal row with an invalid done flag", async () => {
  const { database } = databaseOf([["g1", "p1", "Ship", 5, 0]]);
  await expect(
    new ProjectGoalRepository(database).findByProjectId("p1"),
  ).rejects.toThrow('"is_done"');
});

it("inserts a goal as not done", async () => {
  const { database, execute } = databaseOf();
  await new ProjectGoalRepository(database).insert({
    id: "g1",
    projectId: "p1",
    title: "Ship",
    position: 3,
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "g1",
    project_id: "p1",
    title: "Ship",
    position: 3,
  });
});

it("updates the done flag as 1 or 0", async () => {
  const { database, execute } = databaseOf();
  const repository = new ProjectGoalRepository(database);
  await repository.update("g1", "A", true);
  await repository.update("g1", "A", false);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ is_done: 1 });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({ is_done: 0 });
});

it("deletes a goal by id", async () => {
  const { database, execute } = databaseOf();
  await new ProjectGoalRepository(database).delete("g1");
  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "g1" });
});
