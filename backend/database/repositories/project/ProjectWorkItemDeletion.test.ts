import { expect, it, vi } from "vitest";

import { deleteProjectWorkItemData } from "./ProjectWorkItemDeletion";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("returns attachment names and deletes ticket data of the project", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    ["a.bin"],
    ["b.bin"],
  ]);
  const files = await deleteProjectWorkItemData({ execute, query }, "p1");
  expect(files).toEqual(["a.bin", "b.bin"]);
  expect(execute).toHaveBeenCalledTimes(9);
  expect(execute.mock.calls.every((call) => call[1]?.project_id === "p1")).toBe(
    true,
  );
});
