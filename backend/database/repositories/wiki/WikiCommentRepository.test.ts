import { expect, it, vi } from "vitest";

import { WikiCommentRepository } from "./WikiCommentRepository";

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

const commentRow: DatabaseValue[] = [
  "id",
  "page",
  null,
  "author",
  null,
  "body",
  null,
  null,
  null,
  "created",
  "updated",
  null,
  null,
];

it("inserts a comment and returns its generated identifier", async () => {
  const { database, execute } = databaseOf();

  const id = await new WikiCommentRepository(database).insert({
    pageId: "page",
    parentId: null,
    authorId: "author",
    body: "body",
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
  });

  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO wiki_comments"),
    expect.objectContaining({ id, page_id: "page", body: "body" }),
  );
});

it("lists and finds comments with optional names", async () => {
  const { database } = databaseOf([commentRow]);
  const repository = new WikiCommentRepository(database);
  const named = [...commentRow];
  named[4] = "Author";
  named[11] = "resolved";
  named[12] = "Resolver";

  const [listed] = await repository.listByPage("page");
  const found = await repository.find("id");

  expect(listed).toMatchObject({ authorName: "", resolvedAt: null });
  expect(found).toEqual(listed);
  expect(
    await new WikiCommentRepository(databaseOf([named]).database).find("id"),
  ).toMatchObject({ authorName: "Author", resolvedByName: "Resolver" });
});

it("returns null for a missing comment", async () => {
  await expect(
    new WikiCommentRepository(databaseOf().database).find("id"),
  ).resolves.toBeNull();
});

it("updates the body and the resolution", async () => {
  const { database, execute } = databaseOf();
  const repository = new WikiCommentRepository(database);

  await repository.updateBody("id", "new");
  await repository.setResolved("id", "user");
  await repository.setResolved("id", null);

  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("SET body"),
    { body: "new", id: "id" },
  );
  expect(execute).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining("resolved_at"),
    { id: "id", resolved_by: null },
  );
});

it("deletes the mentions and the thread of a comment", async () => {
  const { database, execute } = databaseOf();

  await new WikiCommentRepository(database).delete("id");

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("DELETE FROM wiki_mentions"),
    { id: "id" },
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("DELETE FROM wiki_comments"),
    { id: "id" },
  );
});
