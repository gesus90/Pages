import { expect, it, vi } from "vitest";

import { EligibleAssigneeRepository } from "./EligibleAssigneeRepository";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TaskDatabase } from "./TaskDatabase";

function repositoryOf(rows: DatabaseValue[][]): {
  readonly repository: EligibleAssigneeRepository;
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
  return { repository: new EligibleAssigneeRepository(database), query };
}

const ROW: DatabaseValue[] = [
  "u1",
  "ann",
  "Ann",
  "admin",
  1,
  "icon",
  "star",
  "#fff",
  null,
  0,
];

it("maps the active users", async () => {
  const [user] = await repositoryOf([ROW]).repository.findCandidates();

  expect(user).toEqual({
    id: "u1",
    username: "ann",
    displayName: "Ann",
    role: "admin",
    isActive: true,
    mustChangePassword: false,
    avatarType: "icon",
    avatarIcon: "star",
    avatarColor: "#fff",
    avatarImageUrl: null,
  });
});

it("rejects an unsupported role", async () => {
  const { repository } = repositoryOf([
    [...ROW.slice(0, 3), "king", ...ROW.slice(4)],
  ]);

  await expect(repository.findCandidates()).rejects.toThrow(
    'unsupported role "king"',
  );
});

it("rejects an unsupported avatar type", async () => {
  const { repository } = repositoryOf([
    [...ROW.slice(0, 5), "hat", ...ROW.slice(6)],
  ]);

  await expect(repository.findCandidates()).rejects.toThrow(
    'unsupported avatar type "hat"',
  );
});

it("returns the same candidates under every project", async () => {
  const { repository, query } = repositoryOf([ROW]);

  const byProject = await repository.findByProjectIds(["p1", "p2"]);

  expect(byProject.get("p1")).toBe(byProject.get("p2"));
  expect(query).toHaveBeenCalledOnce();
});

it("returns an empty map without querying for no projects", async () => {
  const { repository, query } = repositoryOf([ROW]);

  expect((await repository.findByProjectIds([])).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
});
