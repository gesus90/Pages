import { expect, it, vi, type Mock } from "vitest";

import { ProjectMemberRepository } from "./ProjectMemberRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  return { database: { execute, query: async () => rows }, execute };
}

const MEMBER_ROW: DatabaseValue[] = [
  "u1",
  "ann",
  "Ann",
  "icon",
  "star",
  null,
  null,
  "manager",
  "2026-01-01",
  1,
];

it("tells membership from the count", async () => {
  expect(
    await new ProjectMemberRepository(databaseOf([[2]]).database).isMember(
      "p",
      "u",
    ),
  ).toBe(true);
  expect(
    await new ProjectMemberRepository(databaseOf([[0n]]).database).isMember(
      "p",
      "u",
    ),
  ).toBe(false);
});

it("fails without a membership count", async () => {
  await expect(
    new ProjectMemberRepository(databaseOf().database).isMember("p", "u"),
  ).rejects.toThrow("no membership count");
});

it("tells the manager role from the count", async () => {
  expect(
    await new ProjectMemberRepository(
      databaseOf([[1]]).database,
    ).isProjectManager("p", "u"),
  ).toBe(true);
  expect(
    await new ProjectMemberRepository(
      databaseOf([[0]]).database,
    ).isProjectManager("p", "u"),
  ).toBe(false);
});

it("fails without a manager count", async () => {
  await expect(
    new ProjectMemberRepository(databaseOf().database).isProjectManager(
      "p",
      "u",
    ),
  ).rejects.toThrow("no manager count");
});

it("lists managed project ids", async () => {
  const { database } = databaseOf([["a"], ["b"]]);
  await expect(
    new ProjectMemberRepository(database).findManagedProjectIds("u"),
  ).resolves.toEqual(["a", "b"]);
});

it("maps member rows", async () => {
  const { database } = databaseOf([MEMBER_ROW]);
  await expect(
    new ProjectMemberRepository(database).findByProjectId("p"),
  ).resolves.toEqual([
    {
      userId: "u1",
      username: "ann",
      displayName: "Ann",
      avatarType: "icon",
      avatarIcon: "star",
      avatarColor: null,
      avatarImageUrl: null,
      projectRole: "manager",
      joinedAt: "2026-01-01",
      isActive: true,
    },
  ]);
});

it("rejects an unsupported role", async () => {
  const row = [...MEMBER_ROW];
  row[7] = "boss";
  await expect(
    new ProjectMemberRepository(databaseOf([row]).database).findByProjectId(
      "p",
    ),
  ).rejects.toThrow('unsupported project role "boss"');
});

it("rejects an unsupported avatar type", async () => {
  const row = [...MEMBER_ROW];
  row[3] = "hologram";
  await expect(
    new ProjectMemberRepository(databaseOf([row]).database).findByProjectId(
      "p",
    ),
  ).rejects.toThrow('unsupported avatar type "hologram"');
});

it("adds, updates and removes members", async () => {
  const { database, execute } = databaseOf();
  const repository = new ProjectMemberRepository(database);
  await repository.add("p", "u", "member");
  await repository.add("p", "u", "manager", "2026-02-02");
  await repository.updateRole("p", "u", "member");
  await repository.remove("p", "u");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ joined_at: null });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({ joined_at: "2026-02-02" });
  expect(execute).toHaveBeenCalledTimes(4);
});
