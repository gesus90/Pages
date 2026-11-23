import { expect, it, vi } from "vitest";

import { AgentAssetRevisionRepository } from "./AgentAssetRevisionRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

it("reports a replaced source", async () => {
  const { database, query } = databaseOf([["s1"]]);
  await expect(
    new AgentAssetRevisionRepository(database).isReplaced("s1", "wiki"),
  ).resolves.toBe(true);
  expect(query.mock.calls[0]?.[1]).toEqual({
    source_id: "s1",
    source_type: "wiki",
  });
});

it("reports a source without replacement", async () => {
  const { database } = databaseOf([]);
  await expect(
    new AgentAssetRevisionRepository(database).isReplaced("s1", "ticket"),
  ).resolves.toBe(false);
});

it("stores a replacement", async () => {
  const { database, execute } = databaseOf([]);
  await new AgentAssetRevisionRepository(database).insert(
    "s1",
    "r1",
    "digest",
    "ticket",
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    source_type: "ticket",
    source_id: "s1",
    replacement_id: "r1",
    expected_digest: "digest",
  });
});
