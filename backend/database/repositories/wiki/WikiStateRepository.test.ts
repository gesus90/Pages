import { expect, it, vi } from "vitest";

import { WikiStateRepository } from "./WikiStateRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

function databaseOf(rows: string[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);

  return { database: { execute, query }, execute, query };
}

it("lists favorites, expanded and recent pages of a user", async () => {
  const { database, query } = databaseOf([["a"], ["b"]]);
  const repository = new WikiStateRepository(database);

  await expect(repository.listFavoriteIds("u")).resolves.toEqual(["a", "b"]);
  await expect(repository.listExpandedIds("u")).resolves.toEqual(["a", "b"]);
  await expect(repository.listRecentIds("u")).resolves.toEqual(["a", "b"]);
  expect(query).toHaveBeenCalledTimes(3);
  expect(query).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("wiki_favorites"),
    { user_id: "u" },
  );
});

it("adds and removes favorites and expanded branches", async () => {
  const { database, execute } = databaseOf();
  const repository = new WikiStateRepository(database);

  await repository.setFavorite("u", "p", true);
  await repository.setFavorite("u", "p", false);
  await repository.setExpanded("u", "p", true);
  await repository.setExpanded("u", "p", false);

  const statements = execute.mock.calls.map(([statement]) => String(statement));
  expect(statements[0]).toContain("INSERT INTO wiki_favorites");
  expect(statements[1]).toContain("DELETE FROM wiki_favorites");
  expect(statements[2]).toContain("INSERT INTO wiki_expanded_pages");
  expect(statements[3]).toContain("DELETE FROM wiki_expanded_pages");
  expect(execute).toHaveBeenCalledWith(expect.any(String), {
    page_id: "p",
    user_id: "u",
  });
});

it("records a visit and trims the list of recent pages", async () => {
  const { database, execute } = databaseOf();

  await new WikiStateRepository(database).recordVisit("u", "p");

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("LIMIT 20"),
    { user_id: "u" },
  );
});
