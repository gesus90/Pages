import { expect, it, vi } from "vitest";

import { ClaudeQuotaRepository } from "./ClaudeQuotaRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ClaudeQuotaWindow } from "@/definition/ClaudeQuota";

const WINDOW: ClaudeQuotaWindow = {
  kind: "five_hour",
  usedPercentage: 40,
  resetsAt: "2026-01-02T00:00:00.000Z",
};

function databaseOf(...results: DatabaseValue[][][]): {
  readonly database: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => results.shift() ?? [],
  );
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  return { database: { query, execute }, execute };
}

it("saves one reported window", async () => {
  const { database, execute } = databaseOf();
  await new ClaudeQuotaRepository(database).saveWindow("c1", WINDOW, "t1");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    window_kind: "five_hour",
    used_percentage: 40,
    resets_at: "2026-01-02T00:00:00.000Z",
    observed_at: "t1",
  });
});

it("replaces the windows and removes the ones the reading lacks", async () => {
  const { database, execute } = databaseOf();
  await new ClaudeQuotaRepository(database).replaceWindows(
    "c1",
    [WINDOW],
    "t1",
  );
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    window_kind: "seven_day",
    observed_at: "t1",
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    window_kind: "five_hour",
  });
});

it("saves the plan of a sign-in", async () => {
  const { database, execute } = databaseOf();
  await new ClaudeQuotaRepository(database).savePlan("c1", "pro", "t1");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    plan: "pro",
    observed_at: "t1",
  });
});

it("lists plans and windows by connection with the newest time", async () => {
  const { database } = databaseOf(
    [
      ["c1", "claude_pro", "2026-01-01T00:00:00.000Z"],
      ["c2", null, "2026-01-01T00:00:00.000Z"],
    ],
    [
      ["c1", "five_hour", 40, "r1", "2026-01-03T00:00:00.000Z"],
      ["c1", "seven_day", 10n, "r2", "2026-01-02T00:00:00.000Z"],
      ["c1", "bogus", 1, "r3", "2026-01-09T00:00:00.000Z"],
      ["c3", "seven_day", 5, "r4", "2026-01-04T00:00:00.000Z"],
    ],
  );
  const records = await new ClaudeQuotaRepository(database).list();
  expect(records.get("c1")).toEqual({
    plan: "pro",
    reportedAt: "2026-01-03T00:00:00.000Z",
    windows: [
      { kind: "five_hour", usedPercentage: 40, resetsAt: "r1" },
      { kind: "seven_day", usedPercentage: 10, resetsAt: "r2" },
    ],
  });
  expect(records.get("c2")).toEqual({
    plan: null,
    windows: [],
    reportedAt: "2026-01-01T00:00:00.000Z",
  });
  expect(records.get("c3")).toMatchObject({
    plan: null,
    reportedAt: "2026-01-04T00:00:00.000Z",
  });
  expect(records.size).toBe(3);
});

it("removes the figures of a connection", async () => {
  const { database, execute } = databaseOf();
  await new ClaudeQuotaRepository(database).remove("c1");
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { connection_id: "c1" },
    { connection_id: "c1" },
  ]);
});
