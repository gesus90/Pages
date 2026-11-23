import { afterEach, expect, it, vi } from "vitest";

import {
  AgentDreamingRepository,
  readDreamRequest,
  readDreamSchedule,
} from "./AgentDreamingRepository";

import { AGENT_DREAM_NO_COUNTS } from "@/definition/AgentDreaming";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function doubleOf(rows: (readonly DatabaseValue[])[]): {
  repository: AgentDreamingRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentDreamingRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

function rowOf(overrides: Record<number, DatabaseValue>): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "a1",
    1,
    2,
    "days",
    "08:00",
    null,
    0,
    null,
    null,
    null,
    "2026-01-01 00:00:00",
    null,
    null,
    4n,
    5,
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("returns null for an unknown agent", async () => {
  const { repository } = doubleOf([]);

  expect(await repository.find("a1")).toBeNull();
});

it("reads a plain schedule without model, request or run", async () => {
  const { repository, query } = doubleOf([rowOf({})]);

  const stored = await repository.find("a1");

  expect(query.mock.calls[0]?.[1]).toEqual({ agent_id: "a1" });
  expect(stored).toEqual({
    agentId: "a1",
    schedule: {
      isEnabled: true,
      interval: 2,
      unit: "days",
      time: "08:00",
      weekday: null,
      isOnFullLogbook: false,
    },
    model: null,
    lastRunAt: null,
    createdAt: "2026-01-01 00:00:00",
    request: null,
    logbookThrough: 4,
    toolsThrough: 5,
    lastRun: null,
  });
});

it("reads a model, a request and a stored run", async () => {
  const run = {
    at: "2026-01-02T00:00:00.000Z",
    status: "updated",
    trigger: "manual",
    errorCode: "boom",
    counts: { memoryTaken: 2, memoryDropped: -1, lessonLearned: 1.5 },
    log: [
      { kind: "memoryTaken", text: "kept" },
      { kind: "unknown", text: "x" },
      { kind: "memoryDropped", text: 3 },
      "text",
      null,
    ],
  };
  const { repository } = doubleOf([
    rowOf({
      7: "c1",
      8: "m1",
      9: "2026-01-02 00:00:00",
      11: "2026-01-03 00:00:00",
      12: "logbook",
      15: JSON.stringify(run),
    }),
  ]);

  const stored = await repository.find("a1");

  expect(stored?.model).toEqual({ connectionId: "c1", model: "m1" });
  expect(stored?.lastRunAt).toBe("2026-01-02 00:00:00");
  expect(stored?.request).toEqual({
    at: "2026-01-03 00:00:00",
    trigger: "logbook",
  });
  expect(stored?.lastRun).toMatchObject({
    at: run.at,
    status: "updated",
    trigger: "manual",
    errorCode: "boom",
    log: [{ kind: "memoryTaken", text: "kept" }],
  });
  expect(stored?.lastRun?.counts.memoryTaken).toBe(2);
  expect(stored?.lastRun?.counts.memoryDropped).toBe(0);
  expect(stored?.lastRun?.counts.lessonLearned).toBe(0);
});

it("reads a stored run with unusable parts as defaults", async () => {
  const run = { at: "t", status: "failed", trigger: "other", errorCode: 1 };
  const { repository } = doubleOf([rowOf({ 15: JSON.stringify(run) })]);

  const stored = await repository.find("a1");

  expect(stored?.lastRun).toMatchObject({
    status: "failed",
    trigger: null,
    errorCode: null,
    log: [],
  });
  expect(stored?.lastRun?.counts.memoryTaken).toBe(0);
});

it("reads a run with non-object counts as zero counts", async () => {
  const run = { at: "t", status: "unchanged", counts: "none", log: {} };
  const { repository } = doubleOf([rowOf({ 15: JSON.stringify(run) })]);

  expect((await repository.find("a1"))?.lastRun?.counts.memoryTaken).toBe(0);
});

it("treats an unreadable stored run as none", async () => {
  for (const text of [
    "{broken",
    "7",
    "null",
    JSON.stringify({ at: "t", status: "bogus" }),
    JSON.stringify({ status: "updated" }),
  ]) {
    const { repository } = doubleOf([rowOf({ 15: text })]);

    expect((await repository.find("a1"))?.lastRun).toBeNull();
  }
});

it("rethrows an unexpected parse failure", async () => {
  vi.spyOn(JSON, "parse").mockImplementation(() => {
    throw new Error("unexpected");
  });
  const { repository } = doubleOf([rowOf({ 15: "{}" })]);

  await expect(repository.find("a1")).rejects.toThrow("unexpected");
});

it("falls back to days for an unknown unit and reads a null weekday", () => {
  const schedule = readDreamSchedule([1, "weeks", null, null, 1], 0, false);

  expect(schedule).toEqual({
    isEnabled: false,
    interval: 1,
    unit: "days",
    time: null,
    weekday: null,
    isOnFullLogbook: true,
  });
});

it("reports a stored weekday that is not a number as invalid", () => {
  expect(() => readDreamSchedule([1, "days", null, "3", 0], 0, true)).toThrow(
    'Database returned an invalid count for "dream_weekday".',
  );
});

it("reads a request with the manual trigger by default", () => {
  expect(readDreamRequest(["t", "other"], 0)).toEqual({
    at: "t",
    trigger: "manual",
  });
  expect(readDreamRequest([null, null], 0)).toBeNull();
});

it("saves a schedule and reports whether the agent exists", async () => {
  const change = {
    schedule: {
      isEnabled: true,
      interval: 1,
      unit: "hours" as const,
      time: null,
      weekday: null,
      isOnFullLogbook: true,
    },
    model: { connectionId: "c1", model: "m1" },
  };
  const found = doubleOf([["a1"]]);
  const missing = doubleOf([]);

  expect(await found.repository.saveSchedule("a1", change)).toBe(true);
  expect(found.query.mock.calls[0]?.[1]).toMatchObject({
    connection_id: "c1",
    model: "m1",
  });
  expect(
    await missing.repository.saveSchedule("a1", { ...change, model: null }),
  ).toBe(false);
  expect(missing.query.mock.calls[0]?.[1]).toMatchObject({
    connection_id: null,
    model: null,
  });
});

it("saves a request", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.saveRequest("a1", { at: "t", trigger: "manual" });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    at: "t",
    trigger: "manual",
  });
});

it("saves a run with its cursors", async () => {
  const { repository, execute } = doubleOf([]);
  const run = {
    at: "t",
    status: "updated" as const,
    trigger: null,
    errorCode: null,
    counts: AGENT_DREAM_NO_COUNTS,
    log: [],
  };

  await repository.saveRun("a1", {
    run,
    logbookThrough: 1,
    toolsThrough: null,
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    agent_id: "a1",
    last_run: JSON.stringify(run),
    logbook_through: 1,
    tools_through: null,
  });
});
