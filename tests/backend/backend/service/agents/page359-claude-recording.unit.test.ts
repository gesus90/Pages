import { expect, it, vi } from "vitest";

import { AgentSessionRecorder } from "@/backend/service/agents/sessions/AgentSessionRecorder";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { UNKNOWN_CONTEXT } from "@/backend/service/agents/sessions/AgentSessionUsage";
import { claudeRunUsage } from "@/definition/ClaudeUsageSummary";
import { localMutationSchema } from "@/backend/agents/local/LocalSessionContracts";

import {
  MemorySessionStore,
  sessionRecord,
  sessionRun,
  sessionStep,
} from "./page85-session-fixture";

import type { AgentSessionAttemptRecord } from "@/backend/service/agents/sessions/AgentSessionStore";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { ClaudeUsageObservation } from "@/definition/ClaudeUsage";

const MODEL = "claude-haiku-5-5";
function attempt(): AgentSessionAttemptRecord {
  return {
    key: { planId: "plan", runId: "run", stepId: "step", attemptId: "attempt" },
    userId: "user",
    provider: "claude_code",
    instanceId: "instance",
    groupId: null,
    connectionId: "connection",
    requestedModel: MODEL,
    state: "running",
    context: UNKNOWN_CONTEXT,
    confirmedModel: { value: null, source: null, reportedAt: null },
    confirmedReasoning: { value: null, source: null, reportedAt: null },
    workspace: null,
    updatedAt: "2026-11-13T12:00:00Z",
  };
}
function usage(attemptId: string, inputTokens: number): AgentSessionTurnUsage {
  return {
    attemptId,
    turn: 1,
    provider: "claude_code",
    model: MODEL,
    inputTokens,
    outputTokens: 10,
    cacheReadTokens: 100,
    cacheWriteTokens: 20,
    totalTokens: inputTokens + 130,
    inputIncludesCache: false,
    isPartial: false,
    reportedAt: "2026-11-13T12:00:00Z",
    claudeAccounting: {
      sessionId: attemptId,
      subscription: true,
      models: [],
      costUsd: inputTokens / 1000,
    },
  };
}

it("records native usage while a prompt is running and suppresses the overlapping flat prompt response", async () => {
  const store = new MemorySessionStore();
  const saveUsage = vi.fn(async (entry: AgentSessionTurnUsage) =>
    store.saveTurnUsage(entry),
  );
  const recorder = new AgentSessionRecorder(
    { store, journal: new AgentSessionJournal(store), saveUsage },
    attempt(),
  );
  const observation: ClaudeUsageObservation = {
    sessionId: "native",
    id: "message",
    kind: "message",
    models: [
      {
        model: MODEL,
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 30,
        cacheWriteTokens: 4,
      },
    ],
  };
  recorder.claudeUsage(observation);
  await recorder.drained();
  expect(saveUsage).toHaveBeenCalledTimes(1);
  expect(saveUsage.mock.calls[0]?.[0]).toMatchObject({
    turn: 1,
    claudeObservation: observation,
  });
  expect(
    (await store.readEvents("attempt", 0, 20)).events.some(
      (event) => event.kind === "usage",
    ),
  ).toBe(true);
  recorder.prompted({ inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  await recorder.drained();
  expect(saveUsage).toHaveBeenCalledTimes(1);
  recorder.claudeUsage({ ...observation, id: "second" });
  await recorder.drained();
  expect(saveUsage.mock.calls[1]?.[0].turn).toBe(2);
});

it("records absent Claude usage as null while other providers keep their existing missing-report behavior", async () => {
  const store = new MemorySessionStore();
  const recorder = new AgentSessionRecorder(
    { store, journal: new AgentSessionJournal(store) },
    attempt(),
  );
  recorder.prompted(null);
  await recorder.drained();
  expect(store.usage.get("attempt/1")).toMatchObject({
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    isPartial: true,
  });
  recorder.bind({
    ...attempt(),
    provider: "codex_cli",
    key: { ...attempt().key, attemptId: "codex" },
  });
  recorder.prompted(null);
  await recorder.drained();
  expect(store.usage.has("codex/1")).toBe(false);
});

it("sums both loop iterations and retry attempts once, including a missing-report attempt", () => {
  const first = sessionStep("agent", sessionRecord({ attemptId: "first" }));
  const second = sessionStep("agent", sessionRecord({ attemptId: "second" }));
  const run = sessionRun([], {
    loops: [
      {
        id: "loop",
        name: "Two tickets",
        status: "succeeded",
        count: null,
        sessionPolicy: "reuse",
        condition: null,
        iterations: [
          {
            id: "loop#1",
            number: 1,
            status: "succeeded",
            startedAt: "2026-11-13",
            endedAt: null,
            nodes: [first],
            condition: { state: "not_evaluated", reason: "disabled" },
            error: null,
          },
          {
            id: "loop#2",
            number: 2,
            status: "succeeded",
            startedAt: "2026-11-13",
            endedAt: null,
            nodes: [second],
            condition: { state: "not_evaluated", reason: "disabled" },
            error: null,
          },
        ],
        sessions: [],
        completion: null,
        cleanup: "confirmed",
        startedAt: null,
        endedAt: null,
        error: null,
      },
    ],
  });
  const turns = [
    usage("first", 100),
    usage("second", 200),
    usage("second", 200),
  ];
  const projection = claudeRunUsage(run, turns);
  expect(projection?.total).toMatchObject({
    inputTokens: 300,
    outputTokens: 20,
    cacheReadTokens: 200,
    cacheWriteTokens: 40,
    isIncomplete: false,
  });
  expect(projection?.total.costUsd).toBeCloseTo(0.3, 10);
  expect(projection?.steps).toHaveLength(2);
  expect(
    claudeRunUsage(
      run,
      turns.filter((entry) => entry.attemptId !== "second"),
    )?.total.isIncomplete,
  ).toBe(true);
});

it("keeps raw accounting observations in the durable owner import contract", () => {
  const attemptId = "ea13a1a2-9565-4c31-83bb-bf2a6a06f8f5";
  const entry = {
    ...usage(attemptId, 100),
    claudeObservation: {
      sessionId: "native",
      id: "r1",
      kind: "total",
      models: [
        {
          model: MODEL,
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 100,
          cacheWriteTokens: 20,
        },
      ],
    },
  };
  expect(
    localMutationSchema.parse({ kind: "usage", usage: entry }),
  ).toMatchObject({
    usage: {
      claudeObservation: entry.claudeObservation,
      claudeAccounting: entry.claudeAccounting,
    },
  });
});

it("binds a prompt-only fallback to its native session for later cumulative reconciliation", async () => {
  const store = new MemorySessionStore();
  const recorder = new AgentSessionRecorder(
    { store, journal: new AgentSessionJournal(store) },
    attempt(),
  );
  recorder.prompted(
    {
      inputTokens: 100,
      outputTokens: 20,
      cachedReadTokens: 1000,
      cachedWriteTokens: 200,
      totalTokens: 1320,
    },
    false,
    "native",
  );
  await recorder.drained();
  expect(store.usage.get("attempt/1")?.claudeObservation).toMatchObject({
    sessionId: "native",
    kind: "prompt",
    models: [{ model: MODEL, inputTokens: 100 }],
  });
});
