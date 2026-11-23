import { expect, it, vi } from "vitest";

import { ClaudeUsageRepository } from "./ClaudeUsageRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ClaudeLedger } from "@/definition/ClaudeUsage";

const LEDGER: ClaudeLedger = { settled: [], messages: {}, seen: ["m1"] };

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

it("creates the session ledger when needed and reads it locked", async () => {
  const { database, execute, query } = databaseOf([[JSON.stringify(LEDGER)]]);
  await expect(new ClaudeUsageRepository(database).lock("s1")).resolves.toEqual(
    LEDGER,
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    session_id: "s1",
    state: '{"settled":[],"messages":{},"seen":[]}',
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ session_id: "s1" });
});

it("fails when the session ledger disappeared", async () => {
  const { database } = databaseOf();
  await expect(new ClaudeUsageRepository(database).lock("s1")).rejects.toThrow(
    "Claude session ledger disappeared",
  );
});

it("saves the ledger as JSON", async () => {
  const { database, execute } = databaseOf();
  await new ClaudeUsageRepository(database).save("s1", LEDGER);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    session_id: "s1",
    state: JSON.stringify(LEDGER),
  });
});

it("reads the model overrides of the assigned connection", async () => {
  const { database, query } = databaseOf([
    ['{"sonnet":"anthropic/claude-sonnet-4"}'],
  ]);
  await expect(
    new ClaudeUsageRepository(database).modelOverrides("a1"),
  ).resolves.toEqual({ sonnet: "anthropic/claude-sonnet-4" });
  expect(query.mock.calls[0]?.[1]).toEqual({ attempt_id: "a1" });
});

it("has no overrides for an unknown attempt", async () => {
  const { database } = databaseOf();
  await expect(
    new ClaudeUsageRepository(database).modelOverrides("a1"),
  ).resolves.toEqual({});
});
