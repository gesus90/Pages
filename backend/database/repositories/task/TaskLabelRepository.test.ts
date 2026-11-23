import { expect, it, vi } from "vitest";

import { TaskLabelRepository } from "./TaskLabelRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: TaskLabelRepository;
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
  return { repository: new TaskLabelRepository(database), query, execute };
}

const LABEL_ROW: DatabaseValue[] = ["l1", "Bug", "#f00", "c", "u"];
const LABEL = {
  id: "l1",
  name: "Bug",
  color: "#f00",
  createdAt: "c",
  updatedAt: "u",
};

it("lists the catalog", async () => {
  await expect(repositoryOf([LABEL_ROW]).repository.findAll()).resolves.toEqual(
    [LABEL],
  );
});

it("finds a label by id and by name", async () => {
  const { repository, query } = repositoryOf([LABEL_ROW]);

  await expect(repository.findById("l1")).resolves.toEqual(LABEL);
  await expect(repository.findByName("bug")).resolves.toEqual(LABEL);
  expect(query).toHaveBeenLastCalledWith(expect.any(String), { name: "bug" });
  await expect(repositoryOf().repository.findById("x")).resolves.toBeNull();
});

it("counts the usage of one label, defaulting to zero", async () => {
  expect(await repositoryOf([[3]]).repository.countUsage("l1")).toBe(3);
  expect(
    await repositoryOf([[2]]).repository.countUsage("l1", {
      departmentIds: null,
    }),
  ).toBe(2);
  expect(await repositoryOf().repository.countUsage("l1")).toBe(0);
});

it("counts the usage of every label", async () => {
  const { repository } = repositoryOf([
    ["l1", 2],
    ["l2", 5n],
  ]);

  await expect(
    repository.countUsageByLabel({ departmentIds: [] }),
  ).resolves.toEqual(
    new Map([
      ["l1", 2],
      ["l2", 5],
    ]),
  );
});

it("inserts, updates and deletes labels", async () => {
  const { repository, execute } = repositoryOf();

  await repository.insert({ id: "l1", name: "Bug", color: "#f00" });
  await repository.update("l1", { name: "B", color: "#0f0" });
  await repository.delete("l1");

  expect(execute).toHaveBeenCalledTimes(4);
  expect(execute).toHaveBeenNthCalledWith(1, expect.any(String), {
    color: "#f00",
    id: "l1",
    name: "Bug",
  });
  expect(execute).toHaveBeenNthCalledWith(3, expect.any(String), {
    label_id: "l1",
  });
});

it("groups labels by work item", async () => {
  const { repository } = repositoryOf([
    ["w1", ...LABEL_ROW],
    ["w1", "l2", "Feat", "#00f", "c", "u"],
    ["w2", ...LABEL_ROW],
  ]);

  const labels = await repository.findByWorkItemIds(["w1", "w2"]);

  expect(labels.get("w1")).toHaveLength(2);
  expect(labels.get("w2")).toEqual([LABEL]);
});

it("returns no groups without querying for no work items", async () => {
  const { repository, query } = repositoryOf();

  expect((await repository.findByWorkItemIds([])).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("reports whether an assignment or removal changed a row", async () => {
  expect(await repositoryOf([["l1"]]).repository.assign("w1", "l1")).toBe(true);
  expect(await repositoryOf().repository.assign("w1", "l1")).toBe(false);
  expect(await repositoryOf([["l1"]]).repository.unassign("w1", "l1")).toBe(
    true,
  );
  expect(await repositoryOf().repository.unassign("w1", "l1")).toBe(false);
});
