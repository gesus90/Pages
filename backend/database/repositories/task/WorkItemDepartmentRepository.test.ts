import { expect, it, vi } from "vitest";

import { WorkItemDepartmentRepository } from "./WorkItemDepartmentRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function repositoryOf(answers: DatabaseValue[][][]): {
  readonly repository: WorkItemDepartmentRepository;
  readonly query: ReturnType<typeof vi.fn<TaskDatabase["query"]>>;
  readonly execute: ReturnType<typeof vi.fn<TaskDatabase["execute"]>>;
} {
  const query = vi.fn<TaskDatabase["query"]>(async () => answers.shift() ?? []);
  const execute = vi.fn<TaskDatabase["execute"]>(async () => {});
  const database: TaskDatabase = {
    query,
    execute,
    transaction: async (work) => work({ query, execute }),
    readTransaction: async (work) => work({ query, execute }),
  };
  return {
    repository: new WorkItemDepartmentRepository(database),
    query,
    execute,
  };
}

it("reads the department ids of a ticket", async () => {
  const { repository } = repositoryOf([[["d1"], ["d2"]]]);

  await expect(repository.find("w1")).resolves.toEqual(["d1", "d2"]);
});

it("inserts each department once", async () => {
  const { repository, execute } = repositoryOf([]);

  await repository.insert("w1", ["d1", "d1", "d2"]);

  expect(execute).toHaveBeenCalledTimes(2);
});

it("refuses to replace a missing or archived ticket", async () => {
  const { repository, execute } = repositoryOf([[]]);

  await expect(repository.replace("w1", ["d1"])).resolves.toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

it("refuses to replace when the expected set is stale", async () => {
  const { repository, execute } = repositoryOf([[["w1"]], [["d1"]]]);

  await expect(repository.replace("w1", ["d2"], ["d9"])).resolves.toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

it("refuses when the expected set has the same size but other ids", async () => {
  const { repository } = repositoryOf([[["w1"]], [["d1"]]]);

  await expect(repository.replace("w1", [], ["d2"])).resolves.toBe(false);
});

it("replaces the set when it matches the expectation in any order", async () => {
  const { repository, execute } = repositoryOf([[["w1"]], [["d1"], ["d2"]]]);

  await expect(
    repository.replace("w1", ["d3"], ["d2", "d1", "d2"]),
  ).resolves.toBe(true);
  expect(execute).toHaveBeenCalledTimes(3);
});

it("replaces without an expectation", async () => {
  const { repository, execute } = repositoryOf([[["w1"]]]);

  await expect(repository.replace("w1", [])).resolves.toBe(true);
  expect(execute).toHaveBeenCalledTimes(2);
});
