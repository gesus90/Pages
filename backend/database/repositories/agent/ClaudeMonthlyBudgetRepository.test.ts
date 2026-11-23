import { expect, it, vi } from "vitest";

import { ClaudeMonthlyBudgetRepository } from "./ClaudeMonthlyBudgetRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Pick<DatabaseTransaction, "query">;
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { query }, query };
}

async function limitOf(value: DatabaseValue): Promise<number | null> {
  const { database } = databaseOf([[value]]);
  return new ClaudeMonthlyBudgetRepository(database).limit("u1");
}

it("reads a numeric limit of an agent", async () => {
  const { database, query } = databaseOf([[12.5]]);
  await expect(
    new ClaudeMonthlyBudgetRepository(database).limit("u1"),
  ).resolves.toBe(12.5);
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1" });
});

it("reads a limit stored as text", async () => {
  await expect(limitOf("7")).resolves.toBe(7);
});

it.each([null, -1, "-2", "abc", Number.POSITIVE_INFINITY])(
  "treats %s as no limit",
  async (value) => {
    await expect(limitOf(value)).resolves.toBeNull();
  },
);

it("has no limit for a person without an agent row", async () => {
  const { database } = databaseOf();
  await expect(
    new ClaudeMonthlyBudgetRepository(database).limit("u1"),
  ).resolves.toBeNull();
});

it("sums the known cost and counts the unknown sessions", async () => {
  const { database, query } = databaseOf([["3.5", 2n]]);
  await expect(
    new ClaudeMonthlyBudgetRepository(database).spent("u1", "2026-01-01"),
  ).resolves.toEqual({ known: 3.5, unknownSessions: 2 });
  expect(query.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    since: "2026-01-01",
  });
});

it("spends nothing without a row and ignores an invalid sum", async () => {
  const repository = new ClaudeMonthlyBudgetRepository(databaseOf().database);
  await expect(repository.spent("u1", "s")).resolves.toEqual({
    known: 0,
    unknownSessions: 0,
  });
  const invalid = new ClaudeMonthlyBudgetRepository(
    databaseOf([[null, 1]]).database,
  );
  await expect(invalid.spent("u1", "s")).resolves.toEqual({
    known: 0,
    unknownSessions: 1,
  });
});
