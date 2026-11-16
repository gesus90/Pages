import { beforeEach, expect, it, vi } from "vitest";

import { ProjectCoreRepository } from "@/backend/database/repositories/project/ProjectCoreRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { DatabaseTransaction } from "@/backend/database/Database";

const query = vi.fn();
const execute = vi.fn();
const repository = new ProjectCoreRepository(
  partial<DatabaseTransaction>({ query, execute }),
);
const row = [
  "project",
  null,
  "Project",
  "Description",
  "planned",
  20,
  "blue",
  1,
  null,
  null,
  null,
  null,
  "Notes",
  "created",
  "updated",
];

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
});

it("maps project records and binds member access", async () => {
  query.mockResolvedValue([row]);
  expect(await repository.findById("project")).toMatchObject({
    id: "project",
    status: "planned",
    progress: 20,
    hasIcon: true,
    departments: [],
  });
  expect(await repository.findByMemberId("user")).toHaveLength(1);
  expect(query).toHaveBeenLastCalledWith(expect.any(String), {
    member_id: "user",
  });
});

it("rejects unsupported states and malformed optional columns", async () => {
  for (const [index, value] of [
    [1, 1],
    [4, "invalid"],
    [5, 101],
    [8, 3],
    [9, 3],
    [10, 3],
    [11, 3],
  ] as const) {
    const invalid = [...row];
    invalid[index] = value;
    query.mockResolvedValueOnce([invalid]);
    await expect(repository.findById("project")).rejects.toThrow();
  }
});

it("maps archived projects and returns null for absent records", async () => {
  query.mockResolvedValueOnce([[...row, "archived"]]).mockResolvedValueOnce([]);
  expect(await repository.findArchivedById("project")).toMatchObject({
    id: "project",
    archivedAt: "archived",
  });
  expect(await repository.findById("missing")).toBeNull();
});
