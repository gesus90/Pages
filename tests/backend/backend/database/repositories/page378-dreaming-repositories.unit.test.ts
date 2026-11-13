import { expect, it, vi } from "vitest";

import { AgentDreamingRepository } from "@/backend/database/repositories/employee/AgentDreamingRepository";
import { AgentRecipeRepository } from "@/backend/database/repositories/employee/AgentRecipeRepository";
import { AgentToolUseRepository } from "@/backend/database/repositories/employee/AgentToolUseRepository";

import type { DatabaseValue } from "@/backend/database/Database";

type Row = readonly DatabaseValue[];

interface Call {
  readonly sql: string;
  readonly parameters: Record<string, unknown> | undefined;
}

/** A database that records every statement and answers each query with the next prepared rows. */
function database(...answers: Row[][]): {
  readonly calls: Call[];
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const calls: Call[] = [];
  const queue = [...answers];
  const query = vi.fn(
    async (sql: string, parameters?: Record<string, unknown>) => {
      calls.push({ sql, parameters });
      return queue.shift() ?? [];
    },
  );
  const execute = vi.fn(
    async (sql: string, parameters?: Record<string, unknown>) => {
      calls.push({ sql, parameters });
    },
  );
  return { calls, query, execute };
}

function recipeRow(
  overrides: Partial<Record<number, DatabaseValue>> = {},
): Row {
  const row: DatabaseValue[] = [
    "r-1",
    "ed",
    "ticket-anlegen",
    "flow",
    "Legt ein Ticket an.",
    '["ticket"]',
    '[{"name":"projekt","description":"ID"}]',
    '[{"tool":"tickets_create","input":{"projectId":"{{projekt}}"},"note":"anlegen"}]',
    "",
    "3× in Sitzungen",
    "2026-11-13",
    2,
    5,
    "2026-11-13T08:00:00.000Z",
    1,
    null,
    0,
    null,
    "dream",
    "2026-11-01 10:00:00",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

it("reads a recipe with its steps, parameters, counters and status", async () => {
  const db = database([
    recipeRow(),
    recipeRow({
      3: "unbekannt",
      7: "kein json",
      15: "failed",
      14: 0,
      16: 2,
      17: "tickets_create: FORBIDDEN",
    }),
  ]);
  const [first, second] = await new AgentRecipeRepository(db).list("ed");
  expect(first).toEqual({
    id: "r-1",
    agentId: "ed",
    name: "ticket-anlegen",
    kind: "flow",
    summary: "Legt ein Ticket an.",
    keywords: ["ticket"],
    parameters: [{ name: "projekt", description: "ID" }],
    steps: [
      {
        tool: "tickets_create",
        input: { projectId: "{{projekt}}" },
        note: "anlegen",
      },
    ],
    body: "",
    evidence: "3× in Sitzungen",
    confirmedOn: "2026-11-13",
    strength: 2,
    useCount: 5,
    lastUsedAt: "2026-11-13T08:00:00.000Z",
    isActive: true,
    disabledReason: null,
    failureStreak: 0,
    lastError: null,
    origin: "dream",
    createdAt: "2026-11-01 10:00:00",
  });
  // What the code does not know reads safely: a kind as knowledge, unreadable steps as none.
  expect(second).toMatchObject({
    kind: "knowledge",
    steps: [],
    isActive: false,
    disabledReason: "failed",
    failureStreak: 2,
    lastError: "tickets_create: FORBIDDEN",
  });
});

it("counts a failure and switches the recipe off at the limit in one statement bound to the agent", async () => {
  const db = database([[2, 0]], [[1, 1]], []);
  const repository = new AgentRecipeRepository(db);
  expect(
    await repository.recordFailure("ed", "r-1", {
      error: "x: FORBIDDEN",
      limit: 2,
    }),
  ).toEqual({
    failureStreak: 2,
    isActive: false,
  });
  expect(
    await repository.recordFailure("ed", "r-1", { error: "x", limit: 2 }),
  ).toEqual({
    failureStreak: 1,
    isActive: true,
  });
  expect(
    await repository.recordFailure("ed", "gone", { error: "x", limit: 2 }),
  ).toBeNull();
  const [call] = db.calls;
  expect(call?.sql).toContain("failure_streak = failure_streak + 1");
  expect(call?.sql).toContain("WHEN failure_streak + 1 >= $limit THEN FALSE");
  expect(call?.sql).toContain("agent_id = $agent_id");
  expect(call?.parameters).toEqual({
    agent_id: "ed",
    id: "r-1",
    error: "x: FORBIDDEN",
    limit: 2,
  });
});

it("counts a use, resets the failures, and switches a recipe on by hand with a fresh start", async () => {
  const db = database([["r-1"]]);
  const repository = new AgentRecipeRepository(db);
  await repository.recordUse("ed", "r-1", "2026-11-13T09:00:00.000Z");
  expect(db.calls[0]?.sql).toContain("use_count = use_count + 1");
  expect(db.calls[0]?.sql).toContain("failure_streak = 0");
  expect(await repository.setActive("ed", "r-1", true)).toBe(true);
  expect(db.calls[1]?.parameters).toEqual({
    agent_id: "ed",
    id: "r-1",
    is_active: true,
  });
  expect(db.calls[1]?.sql).toContain(
    "disabled_reason = CASE WHEN $is_active THEN NULL ELSE 'manual' END",
  );
  expect(await repository.setActive("ed", "gone", false)).toBe(false);
});

it("reads the schedule, the cursors and the log of the last run of an agent", async () => {
  const run = {
    at: "2026-11-13T02:00:00.000Z",
    status: "updated",
    trigger: "schedule",
    errorCode: null,
    counts: { memoryTaken: 2, recipeCreated: 1 },
    log: [
      { kind: "memoryTaken", text: "Release Freitag" },
      { kind: "unbekannt", text: "wird ignoriert" },
    ],
  };
  const db = database([
    [
      "ed",
      1,
      6,
      "hours",
      null,
      null,
      0,
      "conn",
      "model-x",
      "2026-11-13 02:00:00",
      "2026-11-01 10:00:00",
      "2026-11-13 09:00:00",
      "logbook",
      41,
      17,
      JSON.stringify(run),
    ],
  ]);
  const stored = await new AgentDreamingRepository(db).find("ed");
  expect(stored).toMatchObject({
    agentId: "ed",
    schedule: {
      isEnabled: true,
      interval: 6,
      unit: "hours",
      time: null,
      weekday: null,
      isOnFullLogbook: false,
    },
    model: { connectionId: "conn", model: "model-x" },
    lastRunAt: "2026-11-13 02:00:00",
    request: { at: "2026-11-13 09:00:00", trigger: "logbook" },
    logbookThrough: 41,
    toolsThrough: 17,
  });
  expect(stored?.lastRun).toMatchObject({
    status: "updated",
    trigger: "schedule",
    counts: { memoryTaken: 2, recipeCreated: 1, lessonLearned: 0 },
    log: [{ kind: "memoryTaken", text: "Release Freitag" }],
  });
});

it("saves the schedule without touching the revision, keeps an earlier request and moves the cursors with a run", async () => {
  const db = database([["ed"]]);
  const repository = new AgentDreamingRepository(db);
  expect(
    await repository.saveSchedule("ed", {
      schedule: {
        isEnabled: true,
        interval: 30,
        unit: "days",
        time: "02:00",
        weekday: null,
        isOnFullLogbook: true,
      },
      model: null,
    }),
  ).toBe(true);
  expect(db.calls[0]?.sql).not.toContain("revision");
  expect(db.calls[0]?.parameters).toMatchObject({
    interval: 30,
    unit: "days",
    time: "02:00",
    connection_id: null,
    model: null,
  });
  await repository.saveRequest("ed", {
    at: "2026-11-13 09:00:00",
    trigger: "manual",
  });
  expect(db.calls[1]?.sql).toContain("dream_requested_at IS NULL");
  await repository.saveRun("ed", {
    run: {
      at: "x",
      status: "unchanged",
      trigger: "manual",
      errorCode: null,
      counts: {} as never,
      log: [],
    },
    logbookThrough: 50,
    toolsThrough: null,
  });
  expect(db.calls[2]?.sql).toContain("dream_requested_at = NULL");
  expect(db.calls[2]?.sql).toContain(
    "COALESCE($logbook_through, dream_logbook_through)",
  );
  expect(db.calls[2]?.parameters).toMatchObject({
    logbook_through: 50,
    tools_through: null,
  });
});

it("stores a tool call and reads the calls after a cursor, bounded to one agent", async () => {
  const db = database([
    [3, "2026-11-13 09:00:00", "tickets_search", '{"q":"x"}', "[]", 1, null],
    [4, "2026-11-13 09:01:00", "tickets_create", "{}", "", 0, "FORBIDDEN"],
  ]);
  const repository = new AgentToolUseRepository(db);
  const uses = await repository.since("ed", 2, 400);
  expect(uses.map((use) => [use.id, use.tool, use.isOk, use.error])).toEqual([
    [3, "tickets_search", true, null],
    [4, "tickets_create", false, "FORBIDDEN"],
  ]);
  expect(db.calls[0]?.sql).toContain("WHERE agent_id = $agent_id");
  await repository.append("ed", {
    tool: "t",
    input: "{}",
    output: "",
    isOk: true,
    error: null,
  });
  expect(db.calls[1]?.parameters).toMatchObject({
    agent_id: "ed",
    tool: "t",
    is_ok: true,
  });
});
