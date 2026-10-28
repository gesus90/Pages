import { expect, it } from "vitest";

import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";

import { scriptedDatabase } from "./scripted-database";

it("lists groups with the members that belong to each of them", async () => {
  const scripted = scriptedDatabase();
  scripted.answer(
    [
      ["group-a", "Alpha"],
      ["group-b", "Beta"],
    ],
    [
      ["group-a", "user-1"],
      ["group-b", "user-2"],
      ["group-a", "user-3"],
    ],
  );

  await expect(
    new UserGroupRepository(scripted.database).findAll(),
  ).resolves.toEqual([
    { id: "group-a", memberIds: ["user-1", "user-3"], name: "Alpha" },
    { id: "group-b", memberIds: ["user-2"], name: "Beta" },
  ]);
});

it("summarizes groups with their member count from bigint and number counts", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([
    ["group-a", "Alpha", 2n],
    ["group-b", "Beta", 0],
  ]);

  await expect(
    new UserGroupRepository(scripted.database).findSummaries(),
  ).resolves.toEqual([
    { id: "group-a", memberCount: 2, name: "Alpha" },
    { id: "group-b", memberCount: 0, name: "Beta" },
  ]);
});

it("returns one group summary or null for an unknown group", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([["group-a", "Alpha", 3n]], []);
  const repository = new UserGroupRepository(scripted.database);

  await expect(repository.findSummaryById("group-a")).resolves.toEqual({
    id: "group-a",
    memberCount: 3,
    name: "Alpha",
  });
  await expect(repository.findSummaryById("missing")).resolves.toBeNull();
  expect(scripted.statements[1]?.parameters).toEqual({ id: "missing" });
});

it("returns the ids of the groups a user belongs to", async () => {
  const scripted = scriptedDatabase();
  scripted.answer([["group-a"], ["group-b"]]);

  await expect(
    new UserGroupRepository(scripted.database).findIdsByMember("user-1"),
  ).resolves.toEqual(["group-a", "group-b"]);
  expect(scripted.statements[0]?.parameters).toEqual({ user_id: "user-1" });
});

it("saves a group and replaces its members once each", async () => {
  const scripted = scriptedDatabase();

  await new UserGroupRepository(scripted.database).save({
    id: "group-a",
    name: "Alpha",
    memberIds: ["user-1", "user-2", "user-1"],
  });

  expect(scripted.statements.map((entry) => entry.parameters)).toEqual([
    { id: "group-a", name: "Alpha" },
    { id: "group-a" },
    { id: "group-a", user_id: "user-1" },
    { id: "group-a", user_id: "user-2" },
  ]);
  expect(scripted.statements[1]?.statement).toContain(
    "DELETE FROM user_group_members",
  );
});

it("deletes a group after releasing its ticket assignments and members", async () => {
  const scripted = scriptedDatabase();

  await new UserGroupRepository(scripted.database).delete("group-a");

  expect(scripted.statements.map((entry) => entry.statement)).toEqual([
    expect.stringContaining("UPDATE work_items SET assignee_group_id = NULL"),
    expect.stringContaining("DELETE FROM user_group_members"),
    expect.stringContaining("DELETE FROM user_groups"),
  ]);
  expect(
    scripted.statements.every((entry) => entry.parameters.id === "group-a"),
  ).toBe(true);
});
