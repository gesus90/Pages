import { expect, it, vi } from "vitest";

import { ChatContextRepository } from "./ChatContextRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: Pick<Database, "query">;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
} {
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { query }, query };
}

it("reads the context snapshot of an own session", async () => {
  const { database, query } = databaseOf([["sum", "m1", 3]]);
  await expect(
    new ChatContextRepository(database).read("u1", "s1"),
  ).resolves.toEqual({ summary: "sum", throughId: "m1", revision: 3 });
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1", session_id: "s1" });
});

it("returns null for a foreign or missing session", async () => {
  const { database } = databaseOf([]);
  await expect(
    new ChatContextRepository(database).read("u1", "s1"),
  ).resolves.toBeNull();
});

it("reports whether the replacement was committed", async () => {
  const replacement = {
    summary: "s",
    throughId: "m1",
    expectedRevision: 2,
    latestId: "m2",
  };
  const stored = databaseOf([["s1"]]);
  await expect(
    new ChatContextRepository(stored.database).save("u1", "s1", replacement),
  ).resolves.toBe(true);
  expect(stored.query.mock.calls[0]?.[1]).toEqual({
    user_id: "u1",
    session_id: "s1",
    summary: "s",
    through_id: "m1",
    expected_revision: 2,
    latest_id: "m2",
  });
  const stale = databaseOf([]);
  await expect(
    new ChatContextRepository(stale.database).save("u1", "s1", replacement),
  ).resolves.toBe(false);
});
