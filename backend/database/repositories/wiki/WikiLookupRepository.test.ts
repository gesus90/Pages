import { expect, it, vi } from "vitest";

import { WikiLookupRepository } from "./WikiLookupRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: WikiLookupRepository;
  readonly query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const database: DatabaseTransaction = { execute: async () => {}, query };

  return { repository: new WikiLookupRepository(database), query };
}

it("tells whether an account is active", async () => {
  await expect(repositoryOf([[1]]).repository.isActiveUser("u")).resolves.toBe(
    true,
  );
  await expect(repositoryOf().repository.isActiveUser("u")).resolves.toBe(
    false,
  );
});

it("reads a user name or an empty text", async () => {
  await expect(
    repositoryOf([["Name"]]).repository.findUserName("u"),
  ).resolves.toBe("Name");
  await expect(repositoryOf().repository.findUserName("u")).resolves.toBe("");
});

it("reads project names", async () => {
  const { repository, query } = repositoryOf([["p", "Project"]]);

  await expect(repository.findProjectNames(["p"])).resolves.toEqual([
    { id: "p", name: "Project" },
  ]);
  expect(query).toHaveBeenCalledWith(expect.any(String), { project_0: "p" });
});

it("lists active users and departments", async () => {
  await expect(
    repositoryOf([["u", "User"]]).repository.listActiveUsers(),
  ).resolves.toEqual([{ id: "u", displayName: "User" }]);
  await expect(
    repositoryOf([["d", "Department"]]).repository.listDepartments(),
  ).resolves.toEqual([{ id: "d", name: "Department" }]);
});

it("lists milestones and epics", async () => {
  await expect(
    repositoryOf([
      ["m", "Milestone", "p", "Project"],
    ]).repository.listMilestones(["p"]),
  ).resolves.toEqual([
    { id: "m", name: "Milestone", projectId: "p", projectName: "Project" },
  ]);
  await expect(
    repositoryOf([["e", "KEY-1", "Epic", "p", '["d"]']]).repository.listEpics([
      "p",
    ]),
  ).resolves.toEqual([
    {
      id: "e",
      key: "KEY-1",
      title: "Epic",
      projectId: "p",
      departmentIds: ["d"],
    },
  ]);
});

it("searches users by name with a truncated limit", async () => {
  const { repository, query } = repositoryOf([["u", "user", "User"]]);

  await expect(repository.searchUsers("us%", 3.5)).resolves.toEqual([
    { id: "u", username: "user", displayName: "User" },
  ]);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("LIMIT 3;"),
    expect.objectContaining({ pattern: "%us\\%%" }),
  );
});

it("finds active users by lower-cased user names", async () => {
  const { repository, query } = repositoryOf([["u", "user"]]);

  await expect(
    repository.findActiveUsersByUsernames(["User"]),
  ).resolves.toEqual([{ id: "u", username: "user" }]);
  expect(query).toHaveBeenCalledWith(expect.any(String), { name_0: "user" });
});
