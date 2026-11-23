import { expect, it, vi } from "vitest";

import { AgentOperationKeyRepository } from "./AgentOperationKeyRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: Pick<DatabaseTransaction, "execute" | "query">;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

it("finds the prior result of an operation", async () => {
  const { database, query } = databaseOf([["fp", "ui.wiki.save", "{}"]]);
  await expect(
    new AgentOperationKeyRepository(database).find("u1", "o1"),
  ).resolves.toEqual({
    fingerprint: "fp",
    operation: "ui.wiki.save",
    resultJson: "{}",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    operation_id: "o1",
  });
});

it("returns null for an unknown operation", async () => {
  const { database } = databaseOf([]);
  await expect(
    new AgentOperationKeyRepository(database).find("u1", "o1"),
  ).resolves.toBeNull();
});

it("saves a completed result with the current time", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1234);
  const { database, execute } = databaseOf([]);
  await new AgentOperationKeyRepository(database).insert("u1", "o1", {
    fingerprint: "fp",
    operation: "op",
    resultJson: "{}",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    operation_id: "o1",
    operation: "op",
    fingerprint: "fp",
    result_json: "{}",
    created_at: 1234,
  });
  vi.restoreAllMocks();
});

it("removes older results of one operation", async () => {
  const { database, execute } = databaseOf([]);
  await new AgentOperationKeyRepository(database).removeOlder("u1", "op", 99);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    operation: "op",
    before: 99,
  });
});
