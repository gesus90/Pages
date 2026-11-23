import { expect, it, vi } from "vitest";

import { WikiMentionRepository } from "./WikiMentionRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

const source = { pageId: "page", commentId: "comment", authorId: "author" };

it("removes other mentions and inserts every given person", async () => {
  const execute = vi.fn(async () => {});
  const database: DatabaseTransaction = { execute, query: async () => [] };

  await new WikiMentionRepository(database).replace(source, ["u1", "u2"]);

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("NOT (user_id IN ($keep_0, $keep_1))"),
    { keep_0: "u1", keep_1: "u2", comment_id: "comment", page_id: "page" },
  );
  expect(execute).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining("INSERT INTO wiki_mentions"),
    {
      comment_id: "comment",
      created_by: "author",
      page_id: "page",
      user_id: "u2",
    },
  );
});

it("removes every mention when nobody is mentioned", async () => {
  const execute = vi.fn(async () => {});
  const database: DatabaseTransaction = { execute, query: async () => [] };

  await new WikiMentionRepository(database).replace(source, []);

  expect(execute).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledWith(expect.stringContaining("NOT (FALSE)"), {
    comment_id: "comment",
    page_id: "page",
  });
});
