import { expect, it, vi } from "vitest";

import { MilestoneInitiativeRepository } from "./MilestoneInitiativeRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: MilestoneInitiativeRepository;
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
    repository: new MilestoneInitiativeRepository(database),
    query,
    execute,
  };
}

it("returns no links without querying for no projects", async () => {
  const { repository, query } = repositoryOf();

  await expect(repository.findByProjectIds([])).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("maps the links of the given projects", async () => {
  const { repository } = repositoryOf([["m1", "i1"]]);

  await expect(repository.findByProjectIds(["p1"])).resolves.toEqual([
    { milestoneId: "m1", initiativeId: "i1" },
  ]);
});

it("inserts and deletes a link", async () => {
  const { repository, execute } = repositoryOf();

  await repository.insert("m1", "i1");
  await repository.delete("m1", "i1");

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenLastCalledWith(expect.any(String), {
    initiative_id: "i1",
    milestone_id: "m1",
  });
});

it("reports whether a work item took the milestone", async () => {
  expect(
    await repositoryOf([["w1"]]).repository.setMilestoneIfEmpty("w1", "m1"),
  ).toBe(true);
  expect(
    await repositoryOf([]).repository.setMilestoneIfEmpty("w1", "m1"),
  ).toBe(false);
});

it("clears the milestone of a work item", async () => {
  const { repository, execute } = repositoryOf();

  await repository.clearMilestone("w1", "m1");

  expect(execute).toHaveBeenCalledWith(expect.any(String), {
    id: "w1",
    milestone_id: "m1",
  });
});

it("counts the dependents of an initiative", async () => {
  const { repository } = repositoryOf([[4n]]);

  await expect(repository.countDependents("i1", "m1")).resolves.toBe(4);
});
