import { expect, it, vi } from "vitest";

import { antigravityUsage } from "@/backend/service/agents/sessions/AntigravityUsage";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";

import {
  MemorySessionStore,
  sessionRecord,
  sessionRun,
  sessionStep,
} from "./page85-session-fixture";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";

function usage(
  attemptId: string,
  overrides: Partial<AgentSessionTurnUsage> = {},
): AgentSessionTurnUsage {
  return {
    attemptId,
    turn: 1,
    provider: "antigravity",
    model: "gemini-test",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 120,
    inputIncludesCache: null,
    isPartial: true,
    reportedAt: "2026-11-15T12:00:00.000Z",
    ...overrides,
  };
}

it("sums loops and attempts once, keeps providers apart and never infers reasoning", async () => {
  const calculate = vi.fn(async () => ({
    amountUsd: 0.1,
    gap: null,
    modelId: "google/gemini-test",
    priceAsOf: "2026-11-15",
  }));
  const result = await antigravityUsage({
    turns: [
      usage("a"),
      usage("a"),
      usage("b"),
      usage("c", { provider: "claude_code" }),
    ],
    stepAttempts: new Set(["a"]),
    runAttempts: new Set(["a", "b"]),
    catalog: { calculate },
  });
  expect(result.step).toMatchObject({
    turns: 1,
    totalTokens: 120,
    amountUsd: 0.1,
    reasoningTokens: null,
    isPartial: true,
  });
  expect(result.run).toMatchObject({
    turns: 2,
    totalTokens: 240,
    amountUsd: 0.2,
    priceAsOf: ["2026-11-15"],
  });
  expect(calculate).toHaveBeenCalledTimes(2);
});

it("invalidates estimates with missing attempts or unavailable prices", async () => {
  const result = await antigravityUsage({
    turns: [usage("a")],
    stepAttempts: new Set(["a", "missing"]),
    runAttempts: new Set(["a"]),
  });
  expect(result.step).toMatchObject({
    inputTokens: 100,
    amountUsd: null,
    isPartial: true,
  });
  expect(result.step.gaps).toEqual(
    expect.arrayContaining(["price", "attempt"]),
  );
  const empty = await antigravityUsage({
    turns: [],
    stepAttempts: new Set(),
    runAttempts: new Set(),
  });
  expect(empty.step).toMatchObject({
    inputTokens: null,
    reasoningTokens: null,
    amountUsd: null,
    gaps: ["attempt"],
  });
});

it("uses a confirmed attempt selector only when the turn has no model", async () => {
  const calculate = vi.fn(async (turn: AgentSessionTurnUsage) => ({
    amountUsd: null,
    modelId: turn.model,
    priceAsOf: null,
    gap: "model" as const,
  }));
  await antigravityUsage({
    turns: [usage("a", { model: null }), usage("b")],
    stepAttempts: new Set(["a"]),
    runAttempts: new Set(["a", "b"]),
    confirmedModels: new Map([
      ["a", "confirmed-model"],
      ["b", "another-model"],
    ]),
    catalog: { calculate },
  });
  expect(calculate.mock.calls.map(([turn]) => turn.model)).toEqual([
    "confirmed-model",
    "gemini-test",
  ]);
});

it("records missing Antigravity turns and exposes gaps through the authorized service", async () => {
  const store = new MemorySessionStore();
  const journal = new AgentSessionJournal(store);
  const record = sessionRecord({
    runner: "antigravity",
    effective: { model: "gemini-test" },
    requested: {
      ...sessionRecord().requested,
      runner: "antigravity",
      model: "gemini-test",
      directory: null,
    },
  });
  const run = sessionRun([sessionStep("node", record)]);
  const calculate = vi.fn(async (turn: AgentSessionTurnUsage) => ({
    amountUsd: null,
    modelId: turn.model,
    priceAsOf: null,
    gap: "tokens" as const,
  }));
  const service = new AgentSessionService({
    runs: { run: async () => run, stop: async () => run },
    store,
    journal,
    inbox: new AgentSessionInbox(store, journal),
    priceCatalog: { calculate },
  });
  const listener = service.listen(
    { run, step: { step: { id: "node" } }, record },
    record.instanceId,
  );
  if (!listener) throw new Error("Missing listener");
  listener.update({
    sessionUpdate: "usage_update",
    used: 90_000,
    size: 200_000,
  });
  listener.prompted({ inputTokens: 100, outputTokens: 20, totalTokens: 120 });
  listener.prompted(null);
  await listener.drained?.();
  const view = await service.view("executor", {
    planId: run.planId,
    runId: run.id,
    stepId: "node",
    attemptId: "attempt-1",
  });
  expect(view.turns).toHaveLength(2);
  expect(view.turns[1]).toMatchObject({
    inputTokens: null,
    totalTokens: null,
    isPartial: true,
  });
  expect(view.antigravity?.step).toMatchObject({
    turns: 2,
    inputTokens: 100,
    totalTokens: 120,
    reasoningTokens: null,
    amountUsd: null,
  });
  expect(view.context.contextUsed).toBe(90_000);
  expect(calculate.mock.calls[0]?.[0].model).toBe("gemini-test");
});
