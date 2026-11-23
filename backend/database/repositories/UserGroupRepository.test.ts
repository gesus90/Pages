import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { UserGroupRepository } from "./UserGroupRepository";

import type { Database } from "@/backend/database/Database";

interface Harness {
  readonly execute: Mock;
  readonly query: Mock;
  readonly repository: UserGroupRepository;
}

function repositoryOf(...answers: unknown[][][]): Harness {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async () => answers.shift() ?? []);
  return {
    execute,
    query,
    repository: new UserGroupRepository({
      execute,
      query,
    } as unknown as Database),
  };
}

it("lists groups with members and leaders", async () => {
  const { repository } = repositoryOf(
    [
      ["g1", "Alpha"],
      ["g2", "Beta"],
    ],
    [
      ["g1", "u1", 1],
      ["g1", "u2", 0],
    ],
  );
  await expect(repository.findAll()).resolves.toEqual([
    { id: "g1", leaderIds: ["u1"], memberIds: ["u1", "u2"], name: "Alpha" },
    { id: "g2", leaderIds: [], memberIds: [], name: "Beta" },
  ]);
});

it("lists summaries", async () => {
  const { repository } = repositoryOf([["g", "N", 2n]]);
  await expect(repository.findSummaries()).resolves.toEqual([
    { id: "g", memberCount: 2, name: "N" },
  ]);
});

it("finds one summary or null", async () => {
  await expect(
    repositoryOf([["g", "N", 1]]).repository.findSummaryById("g"),
  ).resolves.toEqual({ id: "g", memberCount: 1, name: "N" });
  await expect(
    repositoryOf([]).repository.findSummaryById("g"),
  ).resolves.toBeNull();
});

it("finds group ids by member", async () => {
  const { repository } = repositoryOf([["a"], ["b"]]);
  await expect(repository.findIdsByMember("u")).resolves.toEqual(["a", "b"]);
});

it("saves a group with the given leaders", async () => {
  const { repository, execute, query } = repositoryOf();
  await repository.save({
    id: "g",
    name: "N",
    memberIds: ["u1", "u1", "u2"],
    leaderIds: ["u2"],
  });
  expect(query).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledTimes(4);
  expect(execute).toHaveBeenCalledWith(expect.any(String), {
    id: "g",
    user_id: "u2",
    is_leader: true,
  });
});

it("keeps the stored leaders when none are given", async () => {
  const { repository, execute } = repositoryOf([["u1"]]);
  await repository.save({ id: "g", name: "N", memberIds: ["u1", "u2"] });
  expect(execute).toHaveBeenCalledWith(expect.any(String), {
    id: "g",
    user_id: "u1",
    is_leader: true,
  });
  expect(execute).toHaveBeenCalledWith(expect.any(String), {
    id: "g",
    user_id: "u2",
    is_leader: false,
  });
});

it("deletes a group with its references", async () => {
  const { repository, execute } = repositoryOf();
  await repository.delete("g");
  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute).toHaveBeenLastCalledWith(
    "DELETE FROM user_groups WHERE id = $id;",
    { id: "g" },
  );
});
