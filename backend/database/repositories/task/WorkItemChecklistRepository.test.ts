import { expect, it, vi } from "vitest";

import { WorkItemChecklistRepository } from "./WorkItemChecklistRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: WorkItemChecklistRepository;
  readonly query: ReturnType<typeof vi.fn<TaskDatabase["query"]>>;
  readonly execute: ReturnType<typeof vi.fn<TaskDatabase["execute"]>>;
} {
  const query = vi.fn<TaskDatabase["query"]>(async () => rows);
  const execute = vi.fn<TaskDatabase["execute"]>(async () => {});
  const database: TaskDatabase = {
    query,
    execute,
    transaction: async (work) => work({ query, execute }),
    readTransaction: async (work) => work({ query, execute }),
  };
  return {
    repository: new WorkItemChecklistRepository(database),
    query,
    execute,
  };
}

const ROW: DatabaseValue[] = ["c1", "w1", "Do", 1, 2, "created", "updated"];
const ITEM = {
  id: "c1",
  workItemId: "w1",
  title: "Do",
  isDone: true,
  sortOrder: 2,
  createdAt: "created",
  updatedAt: "updated",
};

it("lists the items of a work item", async () => {
  await expect(
    repositoryOf([ROW]).repository.findByWorkItemId("w1"),
  ).resolves.toEqual([ITEM]);
});

it("finds an item by id or null", async () => {
  await expect(repositoryOf([ROW]).repository.findById("c1")).resolves.toEqual(
    ITEM,
  );
  await expect(repositoryOf().repository.findById("x")).resolves.toBeNull();
});

it("inserts, updates and deletes items", async () => {
  const { repository, execute } = repositoryOf();

  await repository.insert({ id: "c1", workItemId: "w1", title: "Do" });
  await repository.update("c1", { title: "T", isDone: true });
  await repository.update("c1", { title: "T", isDone: false });
  await repository.delete("c1");

  expect(execute).toHaveBeenNthCalledWith(1, expect.any(String), {
    id: "c1",
    title: "Do",
    work_item_id: "w1",
  });
  expect(execute).toHaveBeenNthCalledWith(2, expect.any(String), {
    id: "c1",
    is_done: 1,
    title: "T",
  });
  expect(execute).toHaveBeenNthCalledWith(3, expect.any(String), {
    id: "c1",
    is_done: 0,
    title: "T",
  });
  expect(execute).toHaveBeenNthCalledWith(4, expect.any(String), { id: "c1" });
});

it("changes or deletes only a current item", async () => {
  const hit = repositoryOf([["c1"]]).repository;
  const miss = repositoryOf().repository;
  const expected = { title: "Do", isDone: true };

  expect(await hit.setDoneIfCurrent("c1", true, expected)).toBe(true);
  expect(
    await hit.setDoneIfCurrent("c1", false, { title: "Do", isDone: false }),
  ).toBe(true);
  expect(await miss.setDoneIfCurrent("c1", true, expected)).toBe(false);
  expect(await hit.deleteIfCurrent("c1", expected)).toBe(true);
  expect(await hit.deleteIfCurrent("c1", { title: "Do", isDone: false })).toBe(
    true,
  );
  expect(await miss.deleteIfCurrent("c1", expected)).toBe(false);
});
