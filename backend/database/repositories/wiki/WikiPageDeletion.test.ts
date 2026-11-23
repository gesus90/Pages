import { expect, it, vi } from "vitest";

import { deleteWikiPages } from "./WikiPageDeletion";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("deletes everything owned by the pages and returns the file names", async () => {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => [["a.bin"], ["b.bin"]]);
  const database: DatabaseTransaction = { execute, query };
  const selection = { sql: "SELECT 1", parameters: { id: "p" } };

  const files = await deleteWikiPages(database, selection);

  expect(files).toEqual(["a.bin", "b.bin"]);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("FROM wiki_attachments"),
    selection.parameters,
  );
  // nine owned tables, the inbound links and the pages themselves
  expect(execute).toHaveBeenCalledTimes(11);
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining("DELETE FROM wiki_page_anchors"),
    selection.parameters,
  );
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining("DELETE FROM wiki_pages WHERE"),
    selection.parameters,
  );
});

it("rejects a file row without a storage name", async () => {
  const database: DatabaseTransaction = {
    execute: async () => {},
    query: async () => [[null]],
  };

  await expect(
    deleteWikiPages(database, { sql: "SELECT 1", parameters: {} }),
  ).rejects.toThrow('"storage_name"');
});
