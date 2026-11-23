import { expect, it, vi } from "vitest";

import { WikiVersionRepository } from "./WikiVersionRepository";

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

const version = {
  pageId: "page",
  revision: 2,
  title: "Title",
  content: "text",
  authorId: "author",
};

it("always inserts when coalescing is off", async () => {
  const { database, execute, query } = databaseOf();

  await new WikiVersionRepository(database).save(version, 0);

  expect(query).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO wiki_page_versions"),
    expect.objectContaining({ page_id: "page", author_id: "author" }),
  );
});

it("refreshes a young version of the same author", async () => {
  const { database, execute } = databaseOf([["old"]]);

  await new WikiVersionRepository(database).save(version, 5);

  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE wiki_page_versions"),
    { content: "text", id: "old", revision: 2, title: "Title" },
  );
});

it("inserts when no version can be refreshed", async () => {
  const { database, execute, query } = databaseOf();

  await new WikiVersionRepository(database).save(version, 5);

  expect(query).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO wiki_page_versions"),
    expect.any(Object),
  );
});

it("lists versions with and without an author name", async () => {
  const row = (name: string | null): DatabaseValue[] => [
    "id",
    3n,
    "Title",
    "author",
    name,
    "created",
    "updated",
  ];
  const { database } = databaseOf([row("Name"), row(null)]);

  const listed = await new WikiVersionRepository(database).list("page");

  expect(listed.map((item) => item.authorName)).toEqual(["Name", ""]);
  expect(listed[0]).toMatchObject({ revision: 3, id: "id" });
});

it("finds a version with its text or null", async () => {
  const found = databaseOf([
    ["id", 1, "T", "a", null, "c", "u", "text"],
  ]).database;

  await expect(
    new WikiVersionRepository(found).find("page", "id"),
  ).resolves.toMatchObject({ content: "text", authorName: "" });
  await expect(
    new WikiVersionRepository(databaseOf().database).find("page", "id"),
  ).resolves.toBeNull();
});

it("prunes versions by age and count", async () => {
  const { database, execute } = databaseOf();

  await new WikiVersionRepository(database).prune(30, 10);

  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM wiki_page_versions"),
    { keep_last: 10, retention_days: 30 },
  );
});
