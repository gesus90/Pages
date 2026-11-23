import { expect, it, vi } from "vitest";

import { deleteProjectWiki } from "./ProjectWikiDeletion";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("deletes agent uploads of the pages first and returns the page files", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [["file-1"]]);
  const files = await deleteProjectWiki({ execute, query }, "p1");
  expect(files).toEqual(["file-1"]);
  expect(String(execute.mock.calls[0]?.[0])).toContain("agent_assets");
  expect(execute.mock.calls[0]?.[1]).toEqual({ project_id: "p1" });
});
