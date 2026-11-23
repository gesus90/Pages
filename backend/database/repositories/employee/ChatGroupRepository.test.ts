import { expect, it, vi } from "vitest";

import { ChatGroupRepository } from "./ChatGroupRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function doubleOf(...results: DatabaseValue[][][]): {
  repository: ChatGroupRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (): Promise<DatabaseValue[][]> => []);
  for (const rows of results) query.mockResolvedValueOnce(rows);
  const execute = vi.fn(async () => undefined);
  const transaction = { query, execute };
  return {
    repository: new ChatGroupRepository({
      query,
      execute,
      transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
        operation(transaction),
    } as unknown as Database),
    query,
    execute,
  };
}

it("lists groups with their members in order", async () => {
  const { repository } = doubleOf(
    [
      ["g1", "One", "d1", "t1"],
      ["g2", "Two", "d2", "t2"],
    ],
    [
      ["g1", "a"],
      ["g1", "b"],
    ],
  );

  expect(await repository.list("o1")).toEqual([
    {
      id: "g1",
      name: "One",
      description: "d1",
      lastActivityAt: "t1",
      memberIds: ["a", "b"],
    },
    {
      id: "g2",
      name: "Two",
      description: "d2",
      lastActivityAt: "t2",
      memberIds: [],
    },
  ]);
});

it("returns member IDs or null for an unknown group", async () => {
  const known = doubleOf([["g1"]], [["a"], ["b"]]);
  const unknown = doubleOf([]);

  expect(await known.repository.memberIds("o1", "g1")).toEqual(["a", "b"]);
  expect(await unknown.repository.memberIds("o1", "g1")).toBeNull();
  expect(unknown.query).toHaveBeenCalledTimes(1);
});

it("creates a group with its members", async () => {
  const { repository, execute } = doubleOf();

  await repository.create("o1", {
    id: "g1",
    name: "N",
    description: "d",
    memberIds: ["a"],
    createdAt: "t",
  });

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "g1",
    owner_id: "o1",
    name: "N",
    description: "d",
    last_activity_at: "t",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    group_id: "g1",
    owner_id: "o1",
    contact_id: "a",
    added_at: "t",
  });
});

it("adds, removes members and removes a group", async () => {
  const { repository, execute } = doubleOf();

  await repository.addMember("o1", "g1", "a", "t");
  await repository.removeMember("o1", "g1", "a");
  await repository.remove("o1", "g1");

  expect(execute.mock.calls[0]?.[1]).toEqual({
    group_id: "g1",
    owner_id: "o1",
    contact_id: "a",
    added_at: "t",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    owner_id: "o1",
    group_id: "g1",
    contact_id: "a",
  });
  expect(execute.mock.calls[2]?.[1]).toEqual({
    owner_id: "o1",
    group_id: "g1",
  });
});

it("touches a group and reports ownership", async () => {
  expect(await doubleOf([["g1"]]).repository.touch("o", "g1", "t")).toBe(true);
  expect(await doubleOf([]).repository.touch("o", "g1", "t")).toBe(false);
});
