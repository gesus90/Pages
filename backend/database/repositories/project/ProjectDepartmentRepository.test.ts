import { expect, it, vi, type Mock } from "vitest";

import { ProjectDepartmentRepository } from "./ProjectDepartmentRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

it("reads the departments of one project", async () => {
  const { database } = databaseOf([["d1", "Design"]]);
  await expect(
    new ProjectDepartmentRepository(database).findByProjectId("p1"),
  ).resolves.toEqual([{ id: "d1", name: "Design" }]);
});

it("returns an empty map without querying for no projects", async () => {
  const { database, query } = databaseOf();
  const result = await new ProjectDepartmentRepository(
    database,
  ).findByProjectIds([]);
  expect(result.size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("groups departments by project", async () => {
  const { database, query } = databaseOf([
    ["p1", "d1", "Design"],
    ["p1", "d2", "Dev"],
    ["p2", "d1", "Design"],
  ]);
  const result = await new ProjectDepartmentRepository(
    database,
  ).findByProjectIds(["p1", "p2"]);
  expect(result.get("p1")).toHaveLength(2);
  expect(result.get("p2")).toEqual([{ id: "d1", name: "Design" }]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    project_0: "p1",
    project_1: "p2",
  });
});

it("replaces assignments and skips duplicate departments", async () => {
  const { database, execute } = databaseOf();
  await new ProjectDepartmentRepository(database).replace("p1", [
    "d1",
    "d1",
    "d2",
  ]);
  expect(execute).toHaveBeenCalledTimes(3);
});
