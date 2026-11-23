import { expect, it, vi } from "vitest";

import { MilestoneDependencyRepository } from "./MilestoneDependencyRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: MilestoneDependencyRepository;
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
    repository: new MilestoneDependencyRepository(database),
    query,
    execute,
  };
}

it("returns no dependencies without querying for no projects", async () => {
  const { repository, query } = repositoryOf();

  await expect(repository.findByProjectIds([])).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("maps the dependencies of the given projects", async () => {
  const { repository, query } = repositoryOf([
    ["d1", "p1", "m1", "m2", "blocks", "2026-01-01"],
  ]);

  await expect(repository.findByProjectIds(["p1"])).resolves.toEqual([
    {
      id: "d1",
      projectId: "p1",
      sourceId: "m1",
      targetId: "m2",
      linkType: "blocks",
      createdAt: "2026-01-01",
    },
  ]);
  expect(query).toHaveBeenCalledWith(expect.any(String), {
    project_id_0: "p1",
  });
});

it("rejects an unknown link type", async () => {
  const { repository } = repositoryOf([["d1", "p1", "m1", "m2", "nope", "x"]]);

  await expect(repository.findByProjectIds(["p1"])).rejects.toThrow(
    "invalid milestone link type",
  );
});

it("inserts, deletes and clears dependencies with bound values", async () => {
  const { repository, execute } = repositoryOf();

  await repository.insert({
    id: "d1",
    projectId: "p1",
    sourceId: "m1",
    targetId: "m2",
    linkType: "follows",
  });
  await repository.delete("d1");
  await repository.deleteByMilestone("m1");

  expect(execute).toHaveBeenNthCalledWith(1, expect.any(String), {
    id: "d1",
    project_id: "p1",
    source_id: "m1",
    target_id: "m2",
    link_type: "follows",
  });
  expect(execute).toHaveBeenNthCalledWith(2, expect.any(String), { id: "d1" });
  expect(execute).toHaveBeenNthCalledWith(3, expect.any(String), {
    milestone_id: "m1",
  });
});
