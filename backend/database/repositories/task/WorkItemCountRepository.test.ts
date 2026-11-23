import { expect, it, vi } from "vitest";

import { WorkItemCountRepository } from "./WorkItemCountRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: WorkItemCountRepository;
  readonly query: ReturnType<typeof vi.fn<TaskDatabase["query"]>>;
} {
  const query = vi.fn<TaskDatabase["query"]>(async () => rows);
  const execute = vi.fn<TaskDatabase["execute"]>(async () => {});
  const database: TaskDatabase = {
    query,
    execute,
    transaction: async (work) => work({ query, execute }),
    readTransaction: async (work) => work({ query, execute }),
  };
  return { repository: new WorkItemCountRepository(database), query };
}

const SCOPE = {
  userId: "u1",
  todayDate: "2026-01-02",
  weekAgoStart: "2025-12-26",
  yesterdayDate: "2026-01-01",
};
const EMPTY = {
  assigned: 0,
  inProgress: 0,
  open: 0,
  openDelta: 0,
  overdue: 0,
  overdueDelta: 0,
};

it("returns an empty overview without querying for no projects", async () => {
  const { repository, query } = repositoryOf();

  await expect(repository.countOverview([], SCOPE)).resolves.toEqual(EMPTY);
  expect(query).not.toHaveBeenCalled();
});

it("maps the overview row and binds the scope", async () => {
  const { repository, query } = repositoryOf([[1, 2, 3, 4, 5, 6n]]);

  await expect(
    repository.countOverview(["p1"], SCOPE, { departmentIds: ["d1"] }),
  ).resolves.toEqual({
    open: 1,
    overdue: 2,
    inProgress: 3,
    assigned: 4,
    openDelta: 5,
    overdueDelta: 6,
  });
  expect(query).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      overview_project_id_0: "p1",
      user_id: "u1",
      visible_department_id_0: "d1",
    }),
  );
});

it("falls back to an empty overview without a row", async () => {
  await expect(
    repositoryOf().repository.countOverview(["p1"], SCOPE),
  ).resolves.toEqual(EMPTY);
});

it("returns no counts without querying for no projects", async () => {
  const { repository, query } = repositoryOf();

  expect((await repository.countByProject([])).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});

it("sums done and total counts per project", async () => {
  const { repository } = repositoryOf([
    ["p1", 0, 3],
    ["p1", 1, 2],
    ["p2", 0, 1],
  ]);

  await expect(repository.countByProject(["p1", "p2"])).resolves.toEqual(
    new Map([
      ["p1", { done: 2, total: 5 }],
      ["p2", { done: 0, total: 1 }],
    ]),
  );
});
