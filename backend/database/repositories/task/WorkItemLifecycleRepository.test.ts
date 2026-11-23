import { describe, expect, it, vi } from "vitest";

import { WorkItemLifecycleRepository } from "./WorkItemLifecycleRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function databaseOf(...results: DatabaseValue[][][]): {
  readonly repository: WorkItemLifecycleRepository;
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => [] as DatabaseValue[][]);
  for (const rows of results) query.mockResolvedValueOnce(rows);
  const execute = vi.fn(async () => {});
  const scope = { query, execute };
  const database = {
    query,
    execute,
    transaction: async (work: (scope: unknown) => Promise<unknown>) =>
      work(scope),
  } as unknown as TaskDatabase;
  return {
    repository: new WorkItemLifecycleRepository(database),
    query,
    execute,
  };
}

describe("WorkItemLifecycleRepository", () => {
  it("finds the subtree ids within the visibility", async () => {
    const { repository, query } = databaseOf([["a"], ["b"]]);

    await expect(
      repository.findSubtreeIds("a", { departmentIds: ["d"] }),
    ).resolves.toEqual(["a", "b"]);
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      root_id: "a",
      visible_department_id_0: "d",
    });
  });

  it("finds the subtree ids without visibility", async () => {
    const { repository } = databaseOf([["a"]]);

    await expect(repository.findSubtreeIds("a")).resolves.toEqual(["a"]);
  });

  it("counts the descendants", async () => {
    const { repository } = databaseOf([["task", 1, 4]]);

    await expect(repository.countDescendants("a")).resolves.toEqual([
      { count: 4, isActive: true, type: "task" },
    ]);
  });

  it.each([
    ["active", "AND archived_at IS NULL"],
    ["all", ""],
  ] as const)("detaches the %s children", async (scope, condition) => {
    const { repository, query, execute } = databaseOf([["c1"], ["c2"]]);

    await expect(repository.detachChildren("p", scope)).resolves.toEqual([
      "c1",
      "c2",
    ]);
    expect(query.mock.calls[0]?.[0]).toContain(
      `parent_id = $parent_id\n              ${condition}`,
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("lists the stored attachment names of the subtree", async () => {
    const { repository } = databaseOf([["f1"]]);

    await expect(repository.findSubtreeStorageNames("a")).resolves.toEqual([
      "f1",
    ]);
  });

  it("archives the active items", async () => {
    const { repository, query } = databaseOf([["a"]]);

    await expect(repository.archiveMany(["a", "b"])).resolves.toEqual(["a"]);
    expect(query.mock.calls[0]?.[0]).toContain("archived_at = utc_now()");
    expect(query.mock.calls[0]?.[0]).toContain("archived_at IS NULL");
  });

  it("restores the archived items", async () => {
    const { repository, query } = databaseOf([["a"]]);

    await expect(repository.restoreMany(["a"])).resolves.toEqual(["a"]);
    expect(query.mock.calls[0]?.[0]).toContain("archived_at = NULL");
    expect(query.mock.calls[0]?.[0]).toContain("archived_at IS NOT NULL");
  });

  it("changes nothing without ids", async () => {
    const { repository, query } = databaseOf();

    await expect(repository.archiveMany([])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("removes a subtree with all dependent rows", async () => {
    const { repository, execute } = databaseOf([["a"], ["b"]]);

    await expect(repository.deleteSubtree("a")).resolves.toEqual(["a", "b"]);
    expect(execute).toHaveBeenCalledTimes(12);
    expect(execute.mock.calls.at(-1)?.[0]).toContain("DELETE FROM work_items");
    expect(execute.mock.calls[0]?.[1]).toEqual({
      item_id_0: "a",
      item_id_1: "b",
    });
  });

  it("removes nothing for an unknown work item", async () => {
    const { repository, execute } = databaseOf([]);

    await expect(repository.deleteSubtree("x")).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
