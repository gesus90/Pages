import { expect, it, vi } from "vitest";

import { AntigravityQuotaRepository } from "./AntigravityQuotaRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AntigravityQuotaGroup } from "@/definition/AntigravityQuota";

const GROUPS: AntigravityQuotaGroup[] = [
  {
    name: "Gemini",
    windows: [
      { kind: "five_hour", remainingFraction: 0.5, resetsAt: "r1" },
      { kind: "seven_day", remainingFraction: 0.25, resetsAt: null },
    ],
  },
  { name: "Empty", windows: [] },
];

function databaseOf(...results: DatabaseValue[][][]): {
  readonly database: Database;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => results.shift() ?? [],
  );
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const transaction = async (
    work: (inner: DatabaseTransaction) => Promise<unknown>,
  ): Promise<unknown> => work({ query, execute });
  return {
    database: { query, execute, transaction } as unknown as Database,
    execute,
    query,
  };
}

it("replaces the stored groups with a newer reading", async () => {
  const { database, execute, query } = databaseOf([["c1"]]);
  await new AntigravityQuotaRepository(database).replaceReading(
    "c1",
    GROUPS,
    "t1",
  );
  expect(query.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    observed_at: "t1",
  });
  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[2]?.[1]).toEqual({
    connection_id: "c1",
    group_position: 0,
    group_name: "Gemini",
    window_kind: "seven_day",
    remaining_fraction: 0.25,
    resets_at: null,
  });
});

it("keeps the stored groups against an older reading", async () => {
  const { database, execute } = databaseOf([]);
  await new AntigravityQuotaRepository(database).replaceReading(
    "c1",
    GROUPS,
    "t0",
  );
  expect(execute).not.toHaveBeenCalled();
});

it("lists the groups of each connection in source order", async () => {
  const { database } = databaseOf(
    [
      ["c1", "t1"],
      ["c2", "t2"],
    ],
    [
      ["c1", 1, "B", "five_hour", 0.5, null],
      ["c1", 0, "A", "five_hour", 1n, "r1"],
      ["c1", 0, "A", "seven_day", 0, null],
      ["c1", 2, "C", "bogus", 1, null],
    ],
  );
  const records = await new AntigravityQuotaRepository(database).list();
  expect(records.get("c1")).toEqual({
    reportedAt: "t1",
    groups: [
      {
        name: "A",
        windows: [
          { kind: "five_hour", remainingFraction: 1, resetsAt: "r1" },
          { kind: "seven_day", remainingFraction: 0, resetsAt: null },
        ],
      },
      {
        name: "B",
        windows: [
          { kind: "five_hour", remainingFraction: 0.5, resetsAt: null },
        ],
      },
    ],
  });
  expect(records.get("c2")).toEqual({ reportedAt: "t2", groups: [] });
});
