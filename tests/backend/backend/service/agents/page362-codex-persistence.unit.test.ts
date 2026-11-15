import { expect, it } from "vitest";

import { CodexPlanUsageRepository } from "@/backend/database/repositories/agent/CodexPlanUsageRepository";
import { readUsageRow } from "@/backend/database/repositories/agent/AgentSessionRows";
import { AgentSessionRecorder } from "@/backend/service/agents/sessions/AgentSessionRecorder";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { UNKNOWN_CONTEXT } from "@/backend/service/agents/sessions/AgentSessionUsage";
import { localMutationSchema } from "@/backend/agents/local/LocalSessionContracts";

import { CodexAccountingDatabase } from "./page362-accounting-fixture";
import { MemorySessionStore } from "./page85-session-fixture";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { CodexTokenCounts } from "@/definition/CodexPlanUsage";

const FIRST: CodexTokenCounts = {
  inputTokens: 100,
  cacheReadTokens: 40,
  outputTokens: 30,
  reasoningTokens: 10,
};
const SECOND: CodexTokenCounts = {
  inputTokens: 180,
  cacheReadTokens: 60,
  outputTokens: 55,
  reasoningTokens: 15,
};

function native(
  totals: CodexTokenCounts,
  options: {
    readonly attempt?: string;
    readonly turn?: number;
    readonly baseline?: boolean;
  } = {},
): AgentSessionTurnUsage {
  return {
    ...totals,
    attemptId: options.attempt ?? "a",
    turn: options.turn ?? 1,
    provider: "codex_cli",
    model: "gpt-6-luna",
    totalTokens: null,
    cacheWriteTokens: null,
    inputIncludesCache: true,
    isPartial: false,
    reportedAt: "2026-11-14T00:00:00Z",
    codex: {
      connectionId: "connection",
      agentId: "agent",
      report: {
        threadId: "thread-1",
        totals,
        baseline: options.baseline ?? false,
        model: "gpt-6-luna",
      },
    },
  };
}

function stored(
  database: CodexAccountingDatabase,
  key: string,
): AgentSessionTurnUsage {
  const row = database.turns.get(key);
  if (!row) throw new Error(`Missing usage ${key}`);
  return readUsageRow(row);
}

it("persists native growth atomically, with replay protection across turns, attempts and resumed threads", async () => {
  const database = new CodexAccountingDatabase();
  const repository = new CodexPlanUsageRepository(database);
  await repository.save(native(FIRST));
  await repository.save(native(FIRST));
  expect(stored(database, "a/1")).toMatchObject({
    ...FIRST,
    totalTokens: 130,
    accounting: { costUsd: 0.464, isSubscription: true },
  });
  await repository.save(native(SECOND, { turn: 2 }));
  expect(stored(database, "a/2")).toMatchObject({
    inputTokens: 80,
    cacheReadTokens: 20,
    outputTokens: 25,
    reasoningTokens: 5,
    totalTokens: 105,
  });
  await repository.save(native(SECOND, { attempt: "retry", baseline: true }));
  expect(database.turns.has("retry/1")).toBe(false);
  await repository.save(native(FIRST, { attempt: "retry" }));
  expect(database.turns.has("retry/1")).toBe(false);
  const third = {
    inputTokens: 200,
    cacheReadTokens: 65,
    outputTokens: 60,
    reasoningTokens: 18,
  };
  await repository.save(native(third, { attempt: "retry" }));
  expect(stored(database, "retry/1")).toMatchObject({
    inputTokens: 20,
    cacheReadTokens: 5,
    outputTokens: 5,
    reasoningTokens: 3,
  });
  expect(
    database.statements.some((statement) => statement.includes("FOR UPDATE")),
  ).toBe(true);
});

it("freezes the exact price version and retains it after price changes or mapping edits", async () => {
  const database = new CodexAccountingDatabase();
  const repository = new CodexPlanUsageRepository(database);
  await repository.save(native(FIRST));
  database.catalog = JSON.stringify({
    fetchedAt: "new-price",
    models: [
      { id: "openai/gpt-6-luna", pricing: { prompt: 99, completion: 99 } },
    ],
  });
  database.mappings = '{"gpt-6-luna":"missing/model"}';
  await repository.save(native(SECOND));
  expect(stored(database, "a/1").accounting).toMatchObject({
    price: { catalogAt: "2026-11-14", prompt: 0.001 },
  });
  expect(stored(database, "a/1").accounting?.costUsd).toBeCloseTo(0.826);
  const fallback = {
    ...native(FIRST, { attempt: "other" }),
    codex: { connectionId: "connection", agentId: "agent", report: null },
  };
  await repository.save(fallback);
  expect(stored(database, "other/1").accounting).toMatchObject({
    price: null,
    costUsd: null,
  });
});

it("rolls back a claimed total when persistence fails, so a retry still records the real consumption", async () => {
  const database = new CodexAccountingDatabase();
  const repository = new CodexPlanUsageRepository(database);
  database.shouldFailWrite = true;
  await expect(repository.save(native(FIRST))).rejects.toThrow("write failed");
  expect(database.watermarks.size).toBe(0);
  database.shouldFailWrite = false;
  await repository.save(native(FIRST));
  expect(stored(database, "a/1").inputTokens).toBe(100);
});

it("keeps native usage through local-owner serialization and does not add the ACP response again", async () => {
  const store = new MemorySessionStore();
  const attempt = {
    key: { planId: "plan", runId: "run", stepId: "step", attemptId: "a" },
    userId: "executor",
    provider: "codex_cli" as const,
    instanceId: "process",
    groupId: null,
    state: "running" as const,
    context: UNKNOWN_CONTEXT,
    confirmedModel: { value: null, source: null, reportedAt: null },
    confirmedReasoning: { value: null, source: null, reportedAt: null },
    workspace: null,
    updatedAt: "now",
    connectionId: "connection",
    agentId: "agent",
    requestedModel: "gpt-6-luna",
  };
  const recorder = new AgentSessionRecorder(
    { store, journal: new AgentSessionJournal(store) },
    attempt,
  );
  const report = native(FIRST).codex?.report;
  recorder.update({
    sessionUpdate: "session_info_update",
    _meta: { pagesCodexUsage: report },
  });
  await recorder.drained();
  const live = store.usage.get("a/1");
  expect(live).toMatchObject({
    ...FIRST,
    codex: { connectionId: "connection", agentId: "agent" },
  });
  expect(
    localMutationSchema.parse({
      kind: "usage",
      usage: { ...live, attemptId: "11111111-1111-4111-8111-111111111111" },
    }),
  ).toMatchObject({ usage: { reasoningTokens: 10, codex: { report } } });
  recorder.prompted({
    inputTokens: 60,
    cachedReadTokens: 40,
    outputTokens: 30,
    thoughtTokens: 10,
    totalTokens: 130,
  });
  await recorder.drained();
  expect(store.usage.size).toBe(1);
  expect(store.usage.get("a/1")?.codex?.report).toEqual(report);
  recorder.prompted(null);
  await recorder.drained();
  expect(store.usage.get("a/2")).toMatchObject({
    inputTokens: null,
    outputTokens: null,
    isPartial: true,
  });
});

it("reconciles delayed native logs with ACP deltas against the durable prompt baseline, including a stale resumed file", async () => {
  const database = new CodexAccountingDatabase();
  const repository = new CodexPlanUsageRepository(database);
  const zero = {
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  await repository.save(native(zero, { baseline: true }));
  const end = native(zero);
  if (!end.codex?.report) throw new Error("Missing synthetic source");
  await repository.save({
    ...end,
    codex: {
      ...end.codex,
      report: { ...end.codex.report, promptTokens: FIRST },
    },
  });
  expect(stored(database, "a/1")).toMatchObject(FIRST);
  // The same numbers reach the rollout after the ACP response; no second billing.
  await repository.save(native(FIRST));
  expect(stored(database, "a/1")).toMatchObject(FIRST);
  // A resumed file is behind the database. Its baseline must retain the durable total.
  await repository.save(native(zero, { attempt: "resumed", baseline: true }));
  const next = native(zero, { attempt: "resumed" });
  if (!next.codex?.report) throw new Error("Missing resumed source");
  await repository.save({
    ...next,
    codex: {
      ...next.codex,
      report: { ...next.codex.report, promptTokens: FIRST },
    },
  });
  expect(stored(database, "resumed/1")).toMatchObject(FIRST);
  await repository.save(
    native(
      {
        inputTokens: 200,
        cacheReadTokens: 80,
        outputTokens: 60,
        reasoningTokens: 20,
      },
      { attempt: "resumed" },
    ),
  );
  expect(stored(database, "resumed/1")).toMatchObject(FIRST);
});

it("does not turn an old thread total into a reported zero for a new turn, or erase a live native report", async () => {
  const database = new CodexAccountingDatabase();
  const repository = new CodexPlanUsageRepository(database);
  await repository.save(native(FIRST));
  await repository.save(native(FIRST, { turn: 2 }));
  const missing: AgentSessionTurnUsage = {
    ...native(FIRST, { turn: 2 }),
    inputTokens: null,
    cacheReadTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    isPartial: true,
    codex: { connectionId: "connection", agentId: "agent", report: null },
  };
  await repository.save(missing);
  expect(stored(database, "a/2")).toMatchObject({
    inputTokens: null,
    outputTokens: null,
    isPartial: true,
  });
  await repository.save(native(SECOND, { turn: 3 }));
  await repository.save({ ...missing, turn: 3 });
  expect(stored(database, "a/3")).toMatchObject({
    inputTokens: 80,
    outputTokens: 25,
    isPartial: false,
  });
});
