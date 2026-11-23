import { expect, it, vi, type Mock } from "vitest";

import { AgentConnectionScopeRepository } from "./AgentConnectionScopeRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

/** Answers each query with the next entry of `answers`; the last one repeats. */
function databaseOf(answers: DatabaseValue[][][] = [[]]): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  let position = 0;
  const query = vi.fn<DatabaseTransaction["query"]>(async () => {
    const answer = answers[Math.min(position, answers.length - 1)] ?? [];
    position += 1;
    return answer;
  });
  return { database: { execute, query }, execute, query };
}

it("returns null for an unknown connection", async () => {
  const { database } = databaseOf([[]]);
  await expect(
    new AgentConnectionScopeRepository(database).find("c1"),
  ).resolves.toBeNull();
});

it("reads a global scope", async () => {
  const { database } = databaseOf([[["global"]]]);
  await expect(
    new AgentConnectionScopeRepository(database).find("c1"),
  ).resolves.toEqual({ mode: "global", targets: [] });
});

it("treats a connection without stored mode as restricted to nobody", async () => {
  const { database } = databaseOf([[[null]]]);
  await expect(
    new AgentConnectionScopeRepository(database).find("c1"),
  ).resolves.toEqual({ mode: "restricted", targets: [] });
});

it("reads the targets of a restricted scope", async () => {
  const { database, query } = databaseOf([
    [["restricted"]],
    [
      ["c1", "person", "u1"],
      ["c1", "group", "g1"],
    ],
  ]);
  await expect(
    new AgentConnectionScopeRepository(database).find("c1"),
  ).resolves.toEqual({
    mode: "restricted",
    targets: [
      { kind: "person", targetId: "u1" },
      { kind: "group", targetId: "g1" },
    ],
  });
  expect(query.mock.calls[1]?.[1]).toEqual({ connection_id: "c1" });
});

it("rejects a stored target of an unknown kind", async () => {
  const { database } = databaseOf([
    [["restricted"]],
    [["c1", "function", "x"]],
  ]);
  await expect(
    new AgentConnectionScopeRepository(database).find("c1"),
  ).rejects.toMatchObject({ code: "connection_scope_invalid" });
});

it("lists every scope with its own targets", async () => {
  const { database } = databaseOf([
    [
      ["c1", "global"],
      ["c2", "restricted"],
      ["c3", null],
    ],
    [
      ["c2", "department", "d1"],
      ["c9", "person", "u9"],
    ],
  ]);
  const scopes = await new AgentConnectionScopeRepository(database).list();
  expect([...scopes]).toEqual([
    ["c1", { mode: "global", targets: [] }],
    [
      "c2",
      { mode: "restricted", targets: [{ kind: "department", targetId: "d1" }] },
    ],
    ["c3", { mode: "restricted", targets: [] }],
  ]);
});

it("saves the mode and replaces the targets of existing directory entries", async () => {
  const { database, execute, query } = databaseOf([[["x"]]]);
  await new AgentConnectionScopeRepository(database).save("c1", {
    mode: "restricted",
    targets: [
      { kind: "person", targetId: "u1" },
      { kind: "group", targetId: "g1" },
      { kind: "department", targetId: "d1" },
    ],
  });
  expect(query.mock.calls.map((call) => call[1])).toEqual([
    { target_id: "u1" },
    { target_id: "g1" },
    { target_id: "d1" },
  ]);
  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { connection_id: "c1", mode: "restricted" },
    { connection_id: "c1" },
    { connection_id: "c1", kind: "person", target_id: "u1" },
    { connection_id: "c1", kind: "group", target_id: "g1" },
    { connection_id: "c1", kind: "department", target_id: "d1" },
  ]);
});

it("saves a global scope without targets", async () => {
  const { database, execute } = databaseOf();
  await new AgentConnectionScopeRepository(database).save("c1", {
    mode: "global",
    targets: [],
  });
  expect(execute).toHaveBeenCalledTimes(2);
});

it("refuses a target that does not exist", async () => {
  const { database, execute } = databaseOf([[]]);
  await expect(
    new AgentConnectionScopeRepository(database).save("c1", {
      mode: "restricted",
      targets: [{ kind: "person", targetId: "u1" }],
    }),
  ).rejects.toMatchObject({ code: "profile_target_invalid" });
  expect(execute).not.toHaveBeenCalled();
});

it("removes targets and mode of a connection", async () => {
  const { database, execute } = databaseOf();
  await new AgentConnectionScopeRepository(database).remove("c1");
  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { connection_id: "c1" },
    { connection_id: "c1" },
  ]);
});

it("names the connections that still list a target", async () => {
  const { database, query } = databaseOf([[["c1", "Main"]]]);
  await expect(
    new AgentConnectionScopeRepository(database).references({
      kind: "group",
      targetId: "g1",
    }),
  ).resolves.toEqual([{ id: "c1", name: "Main" }]);
  expect(query.mock.calls[0]?.[1]).toEqual({ kind: "group", target_id: "g1" });
});
