import { expect, it, vi } from "vitest";

import { WikiAnchorRepository } from "./WikiAnchorRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);

  return { database: { execute, query }, execute, query };
}

it("replaces the anchors of a page", async () => {
  const { database, execute } = databaseOf();

  await new WikiAnchorRepository(database).replaceAnchors("p", [
    { kind: "epic", targetId: "e" },
    { kind: "milestone", targetId: "m" },
  ]);

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining("INSERT INTO wiki_page_anchors"),
    { kind: "milestone", page_id: "p", target_id: "m" },
  );
});

it("reads anchors with and without a label", async () => {
  const { database } = databaseOf([
    ["epic", "e", "Epic"],
    ["milestone", "m", null],
  ]);

  await expect(
    new WikiAnchorRepository(database).findAnchors("p"),
  ).resolves.toEqual([
    { kind: "epic", label: "Epic", targetId: "e" },
    { kind: "milestone", label: null, targetId: "m" },
  ]);
});

it("rejects an unknown anchor kind", async () => {
  const { database } = databaseOf([["galaxy", "e", null]]);

  await expect(
    new WikiAnchorRepository(database).findAnchors("p"),
  ).rejects.toThrow('"kind"');
});

it("finds the pages of each target", async () => {
  const { database, query } = databaseOf([["p1"], ["p2"]]);

  const found = await new WikiAnchorRepository(database).findPageIdsByTargets(
    "department",
    ["d1", "d2"],
  );

  expect(query).toHaveBeenCalledTimes(2);
  expect([...found]).toEqual([
    ["d1", ["p1", "p2"]],
    ["d2", ["p1", "p2"]],
  ]);
});

it("removes the anchors of the subtree for every kind", async () => {
  const { database, execute } = databaseOf();

  await new WikiAnchorRepository(database).removeAnchorsOfSubtree("p", [
    "epic",
    "milestone",
  ]);

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("WITH RECURSIVE subtree"),
    { kind: "milestone", page_id: "p" },
  );
});

it("looks up the target of each anchor kind", async () => {
  const { database, query } = databaseOf([["project", '["d"]']]);
  const repository = new WikiAnchorRepository(database);

  for (const kind of ["department", "epic", "milestone"] as const) {
    await expect(repository.findAnchorTarget(kind, "t")).resolves.toEqual({
      departmentIds: ["d"],
      projectId: "project",
    });
  }
  expect(query.mock.calls.map(([statement]) => String(statement))).toEqual([
    expect.stringContaining("FROM departments"),
    expect.stringContaining("FROM work_items"),
    expect.stringContaining("FROM milestones"),
  ]);
});

it("returns null for a target that does not exist", async () => {
  const { database } = databaseOf();

  await expect(
    new WikiAnchorRepository(database).findAnchorTarget("epic", "t"),
  ).resolves.toBeNull();
});
