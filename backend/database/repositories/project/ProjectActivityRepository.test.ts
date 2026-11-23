import { expect, it, vi, type Mock } from "vitest";

import { ProjectActivityRepository } from "./ProjectActivityRepository";

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

const ROW: DatabaseValue[] = [
  "a1",
  "p1",
  "u1",
  "Ann",
  "tasks",
  "created",
  "msg",
  "2026-01-01",
  "ui",
];

it("maps activity rows, including an unknown author", async () => {
  const { database } = databaseOf([
    ROW,
    [...ROW.slice(0, 3), null, ...ROW.slice(4)],
  ]);
  const entries = await new ProjectActivityRepository(database).findByProjectId(
    "p1",
  );
  expect(entries.map((entry) => entry.userDisplayName)).toEqual(["Ann", null]);
  expect(entries[0]).toMatchObject({ category: "tasks", source: "ui" });
});

it("rejects a non-text author name", async () => {
  const { database } = databaseOf([[...ROW.slice(0, 3), 7, ...ROW.slice(4)]]);
  await expect(
    new ProjectActivityRepository(database).findByProjectId("p1"),
  ).rejects.toThrow('"user_display_name"');
});

it("rejects an unsupported category", async () => {
  const { database } = databaseOf([
    [...ROW.slice(0, 4), "weird", ...ROW.slice(5)],
  ]);
  await expect(
    new ProjectActivityRepository(database).findByProjectId("p1"),
  ).rejects.toThrow('unsupported activity category "weird"');
});

it("rejects an unsupported source", async () => {
  const { database } = databaseOf([[...ROW.slice(0, 8), "fax"]]);
  await expect(
    new ProjectActivityRepository(database).findByProjectId("p1"),
  ).rejects.toThrow("Invalid project activity source.");
});

it("accepts the mcp and ai sources", async () => {
  const { database } = databaseOf([
    [...ROW.slice(0, 8), "mcp"],
    [...ROW.slice(0, 8), "ai"],
  ]);
  const entries = await new ProjectActivityRepository(database).findByProjectId(
    "p1",
  );
  expect(entries.map((entry) => entry.source)).toEqual(["mcp", "ai"]);
});

it("hides wiki activity without a wiki scope", async () => {
  const { database, query } = databaseOf();
  await new ProjectActivityRepository(database).findByProjectId("p1");
  expect(String(query.mock.calls[0]?.[0])).toContain("OR FALSE");
});

it("filters wiki activity through the visible pages of the scope", async () => {
  const { database, query } = databaseOf();
  await new ProjectActivityRepository(database).findByProjectId(
    "p1",
    { departmentIds: [], projectIds: ["p1"] },
    {
      userId: "u1",
      isAdmin: false,
      departmentIds: [],
      projectIds: ["p1"],
    },
  );
  expect(String(query.mock.calls[0]?.[0])).toContain("visible_pages");
});

it("inserts entries with the configured source and optional references", async () => {
  const { database, execute } = databaseOf();
  const entry = {
    id: "a1",
    projectId: "p1",
    userId: "u1",
    category: "tasks" as const,
    action: "created",
    message: "msg",
  };
  await new ProjectActivityRepository(database, "mcp").insert(entry);
  await new ProjectActivityRepository(database).insert({
    ...entry,
    workItemId: "w1",
    wikiPageId: "g1",
  });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    work_item_id: null,
    wiki_page_id: null,
    source: "mcp",
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    work_item_id: "w1",
    wiki_page_id: "g1",
    source: "ui",
  });
});
