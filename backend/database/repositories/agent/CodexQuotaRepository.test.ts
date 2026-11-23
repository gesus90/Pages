import { expect, it, vi } from "vitest";

import {
  CodexQuotaRepository,
  type CodexQuotaReading,
} from "./CodexQuotaRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

const READING: CodexQuotaReading = {
  plan: "plus",
  isLimitReached: false,
  windows: [
    { kind: "primary", usedPercent: 20, durationMinutes: 300, resetsAt: "r1" },
    {
      kind: "secondary",
      usedPercent: 30,
      durationMinutes: null,
      resetsAt: null,
    },
  ],
};

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

it("replaces the stored windows with a newer reading", async () => {
  const { database, execute, query } = databaseOf([["c1"]]);
  await new CodexQuotaRepository(database).replaceReading("c1", READING, "t1");
  expect(query.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    plan: "plus",
    is_limit_reached: false,
    observed_at: "t1",
  });
  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[2]?.[1]).toEqual({
    connection_id: "c1",
    window_kind: "secondary",
    used_percent: 30,
    duration_minutes: null,
    resets_at: null,
  });
});

it("keeps the stored windows against an older reading", async () => {
  const { database, execute } = databaseOf([]);
  await new CodexQuotaRepository(database).replaceReading("c1", READING, "t0");
  expect(execute).not.toHaveBeenCalled();
});

it("lists the quota of each connection", async () => {
  const { database } = databaseOf(
    [
      ["c1", "plus", 1, "t1"],
      ["c2", null, 0, "t2"],
    ],
    [
      ["c1", "primary", 20, 300n, "r1"],
      ["c1", "secondary", 30, null, null],
      ["c1", "bogus", 1, null, null],
    ],
  );
  const records = await new CodexQuotaRepository(database).list();
  expect(records.get("c1")).toEqual({
    plan: "plus",
    isLimitReached: true,
    reportedAt: "t1",
    windows: [
      {
        kind: "primary",
        usedPercent: 20,
        durationMinutes: 300,
        resetsAt: "r1",
      },
      {
        kind: "secondary",
        usedPercent: 30,
        durationMinutes: null,
        resetsAt: null,
      },
    ],
  });
  expect(records.get("c2")).toEqual({
    plan: null,
    isLimitReached: false,
    reportedAt: "t2",
    windows: [],
  });
});
