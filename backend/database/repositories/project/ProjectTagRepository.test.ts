import { expect, it, vi, type Mock } from "vitest";

import { ProjectTagRepository } from "./ProjectTagRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

function databaseOf(rows: (string | null)[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

it("reads the tags of a project in query order", async () => {
  const { database, query } = databaseOf([["a"], ["b"]]);
  await expect(
    new ProjectTagRepository(database).findByProjectId("p1"),
  ).resolves.toEqual(["a", "b"]);
  expect(query.mock.calls[0]?.[1]).toEqual({ project_id: "p1" });
});

it("rejects a tag row without text", async () => {
  const { database } = databaseOf([[null]]);
  await expect(
    new ProjectTagRepository(database).findByProjectId("p1"),
  ).rejects.toThrow('invalid value for "tag"');
});

it("replaces the tags by deleting and inserting each one", async () => {
  const { database, execute } = databaseOf();
  await new ProjectTagRepository(database).replace("p1", ["x", "y"]);
  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[1]?.[1]).toEqual({ project_id: "p1", tag: "x" });
  expect(execute.mock.calls[2]?.[1]).toEqual({ project_id: "p1", tag: "y" });
});

it("only deletes when no tags remain", async () => {
  const { database, execute } = databaseOf();
  await new ProjectTagRepository(database).replace("p1", []);
  expect(execute).toHaveBeenCalledTimes(1);
});
