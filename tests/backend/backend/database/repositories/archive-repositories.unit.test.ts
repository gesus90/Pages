import { expect, it, vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { MilestoneRepository } from "@/backend/database/repositories/task/MilestoneRepository";
import { WorkItemLifecycleRepository } from "@/backend/database/repositories/task/WorkItemLifecycleRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";

function boundary(): TaskDatabase {
  const connection: DatabaseTransaction = {
    query: vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]),
    execute: vi.fn<DatabaseTransaction["execute"]>().mockResolvedValue(),
  };
  return { ...connection, transaction: async (work) => work(connection) };
}

it("reports the rows actually changed by the database rather than requested ids", async () => {
  const database = boundary();
  const query = vi
    .mocked(database.query)
    .mockResolvedValue([["child"], ["root"]]);
  const repository = new TaskRepository(database);

  await expect(
    repository.archiveMany(["root", "child", "already-archived"]),
  ).resolves.toEqual(["child", "root"]);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("RETURNING id"), {
    item_id_0: "root",
    item_id_1: "child",
    item_id_2: "already-archived",
  });
  expect(query.mock.calls[0]?.[0]).toContain("AND archived_at IS NULL");
  expect(database.execute).not.toHaveBeenCalled();
});

it("does not issue a statement for an empty archive set", async () => {
  const database = boundary();
  await expect(
    new WorkItemLifecycleRepository(database).archiveMany([]),
  ).resolves.toEqual([]);
  expect(database.query).not.toHaveBeenCalled();
  expect(database.execute).not.toHaveBeenCalled();
});

it("preserves restore semantics for archived rows", async () => {
  const database = boundary();
  vi.mocked(database.query).mockResolvedValue([["root"]]);
  await expect(
    new TaskRepository(database).restoreMany(["root"]),
  ).resolves.toBeUndefined();
  expect(database.query).toHaveBeenCalledWith(
    expect.stringContaining("AND archived_at IS NOT NULL"),
    { item_id_0: "root" },
  );
  expect(vi.mocked(database.query).mock.calls[0]?.[0]).toContain(
    "archived_at = NULL",
  );
});

it("uses active milestone reads by default and an explicit server option for archive replay", async () => {
  const database = boundary();
  const repository = new MilestoneRepository(database);
  await expect(repository.findById("milestone")).resolves.toBeNull();
  expect(database.query).toHaveBeenLastCalledWith(
    expect.stringContaining("($include_archived OR archived_at IS NULL)"),
    { id: "milestone", include_archived: false },
  );

  vi.mocked(database.query).mockResolvedValue([
    [
      "milestone",
      "engineering",
      "Release",
      "Description",
      "completed",
      null,
      null,
      "2026-01-01",
      "2026-10-14",
      "2026-01-02",
      "2026-10-14",
      null,
      null,
      null,
    ],
  ]);
  await expect(
    new TaskRepository(database).findMilestoneById("milestone", {
      includeArchived: true,
    }),
  ).resolves.toMatchObject({
    id: "milestone",
    status: "completed",
    archivedAt: "2026-10-14",
  });
  expect(database.query).toHaveBeenLastCalledWith(expect.any(String), {
    id: "milestone",
    include_archived: true,
  });
});
