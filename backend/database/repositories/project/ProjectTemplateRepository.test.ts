import { expect, it, vi, type Mock } from "vitest";

import { ProjectTemplateRepository } from "./ProjectTemplateRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ProjectTemplate } from "@/definition/Project";

function databaseOf(results: DatabaseValue[][][]): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => results.shift() ?? [],
  );
  return { database: { execute, query }, execute };
}

it("attaches goals and tags to their templates", async () => {
  const { database } = databaseOf([
    [
      ["t1", "p1", "One", "d", "active"],
      ["t2", "p1", "Two", "d", "planned"],
    ],
    [["t1", "Goal"]],
    [["t1", "tag"]],
  ]);
  const result = await new ProjectTemplateRepository(database).findAll();
  expect(result[0]).toMatchObject({ goals: ["Goal"], tags: ["tag"] });
  expect(result[1]).toMatchObject({ goals: [], tags: [] });
});

it("rejects an unsupported template status", async () => {
  const { database } = databaseOf([[["t1", "p1", "One", "d", "weird"]]]);
  await expect(
    new ProjectTemplateRepository(database).findAll(),
  ).rejects.toThrow("unsupported template status");
});

it("saves the snapshot with goals in order and distinct tags", async () => {
  const { database, execute } = databaseOf([]);
  const template: ProjectTemplate = {
    id: "t1",
    projectId: "p1",
    name: "N",
    description: "D",
    status: "active",
    goals: ["a", "b"],
    tags: ["x", "x", "y"],
  };
  await new ProjectTemplateRepository(database).save(template);
  expect(execute).toHaveBeenCalledTimes(7);
  expect(execute.mock.calls[3]?.[1]).toEqual({
    id: "t1",
    position: 0,
    title: "a",
  });
  expect(execute.mock.calls[6]?.[1]).toEqual({ id: "t1", tag: "y" });
});
