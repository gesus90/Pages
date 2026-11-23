import { expect, it, vi } from "vitest";

import { WikiFeedRepository } from "./WikiFeedRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { WikiVisibilityScope } from "@/definition/Wiki";

const scope: WikiVisibilityScope = {
  userId: "viewer",
  isAdmin: false,
  projectIds: [],
  departmentIds: [],
};

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);

  return { database: { execute, query }, execute, query };
}

it("collects the entries of every reason", async () => {
  const entry = (reason: string, comment: string | null): DatabaseValue[] => [
    reason,
    "page",
    "Title",
    "text",
    "Actor",
    "at",
    comment,
  ];
  const { database, query } = databaseOf([
    entry("mention", "c"),
    entry("reply", "c"),
    entry("comment", "c"),
    entry("expired", null),
    entry("unknown", null),
  ]);

  const items = await new WikiFeedRepository(database).collect(
    scope,
    "2026-01-01",
  );

  expect(items.map((item) => item.reason)).toEqual([
    "mention",
    "reply",
    "comment",
    "expired",
    "expired",
  ]);
  expect(items[0]).toEqual({
    reason: "mention",
    pageId: "page",
    pageTitle: "Title",
    commentId: "c",
    excerpt: "text",
    actorName: "Actor",
    at: "at",
  });
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("LIMIT 100"),
    expect.objectContaining({ today: "2026-01-01", viewer_id: "viewer" }),
  );
});

it("reads the read time or falls back to the earliest one", async () => {
  const repository = new WikiFeedRepository(databaseOf([["read"]]).database);
  const never = new WikiFeedRepository(databaseOf([[null]]).database);
  const none = new WikiFeedRepository(databaseOf().database);

  await expect(repository.findReadTime("u")).resolves.toBe("read");
  await expect(never.findReadTime("u")).resolves.toBe("1970-01-01 00:00:00");
  await expect(none.findReadTime("u")).resolves.toBe("1970-01-01 00:00:00");
});

it("marks the feed as read", async () => {
  const { database, execute } = databaseOf();

  await new WikiFeedRepository(database).markRead("u");

  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO wiki_user_state"),
    { user_id: "u" },
  );
});
