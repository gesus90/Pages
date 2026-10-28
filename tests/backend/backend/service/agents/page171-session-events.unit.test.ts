import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { readPlanSessionEvents } from "@/backend/service/agents/AgentPlanSessionEventRead";
import { translatePlanError } from "@/backend/service/agents/AgentPlanOperationErrors";
import { runDetail } from "@/backend/service/agents/AgentPlanOperationViews";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";

import {
  MemorySessionStore,
  sessionRecord,
  sessionRun,
  sessionStep,
} from "./page85-session-fixture";
import { PlanWorld } from "./plan-operation-world";

const KEY = {
  planId: "plan-1",
  runId: "run-1",
  stepId: "node",
  attemptId: "attempt",
};

it("exposes local and legacy attempt keys without requiring remote execution metadata", () => {
  const run = sessionRun([
    sessionStep("current", sessionRecord({ attemptId: "attempt-current" })),
    sessionStep(
      "legacy",
      sessionRecord({ attemptId: undefined, instanceId: "old" }),
    ),
  ]);
  expect(
    runDetail(run).steps.map((step) => [step.stepId, step.attemptId]),
  ).toEqual([
    ["current", "attempt-current"],
    ["legacy", "old:legacy"],
  ]);
});

async function world(
  options: { readonly isLegacy?: boolean; readonly hasRetry?: boolean } = {},
): Promise<{
  readonly service: AgentSessionService;
  readonly journal: AgentSessionJournal;
  readonly store: MemorySessionStore;
}> {
  const store = new MemorySessionStore();
  await store.saveAttempt({
    key: KEY,
    userId: "executor",
    provider: "claude_code",
    instanceId: "old",
    groupId: null,
    state: "failed",
    context: {
      contextUsed: null,
      contextLimit: null,
      percent: null,
      source: null,
      reportedAt: null,
    },
    confirmedModel: { value: null, source: null, reportedAt: null },
    confirmedReasoning: { value: null, source: null, reportedAt: null },
    workspace: null,
    updatedAt: "2026-10-28T00:00:00Z",
  });
  const journal = new AgentSessionJournal(store);
  const run = sessionRun([
    sessionStep(
      "node",
      sessionRecord({
        attemptId: options.isLegacy ? undefined : KEY.attemptId,
        retry: options.hasRetry
          ? {
              state: "completed",
              reason: "transient",
              nextAttemptAt: null,
              resetAt: null,
              attempts: [
                {
                  attemptId: "previous",
                  sessionId: "native-private",
                  endedAt: "2026-10-28T00:00:00Z",
                  code: "provider_unavailable",
                },
              ],
            }
          : undefined,
        instanceId: "old",
        events: ["first", "second", "third"],
      }),
    ),
  ]);
  const service = new AgentSessionService({
    runs: {
      run: async (userId) => {
        if (userId !== run.userId) throw new AgentError("plan_access_denied");
        return run;
      },
      stop: async () => {
        throw new Error("Read must not stop");
      },
    },
    store,
    journal,
    inbox: new AgentSessionInbox(store, journal),
  });
  return { service, journal, store };
}

it("reads the actual authorized journal in bounded pages without mixing attempts", async () => {
  const { service, journal } = await world();
  await journal.append("attempt", [
    { kind: "agent_message", text: "first", turn: 1 },
    { kind: "error", text: "second", turn: 1 },
  ]);
  const first = await readPlanSessionEvents(service, "executor", {
    ...KEY,
    limit: 1,
  });
  expect(first).toMatchObject({
    sessionEvents: {
      key: KEY,
      history: {
        source: "journal",
        cursor: 1,
        hasMore: true,
        events: [{ text: "first" }],
      },
    },
  });
  const second = await readPlanSessionEvents(service, "executor", {
    ...KEY,
    after: 1,
    before: 3,
    limit: 1,
  });
  expect(second).toMatchObject({
    sessionEvents: {
      history: {
        cursor: 2,
        hasMore: false,
        events: [{ text: "second", kind: "error" }],
      },
    },
  });
  await expect(
    readPlanSessionEvents(service, "foreign", KEY),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  await expect(
    readPlanSessionEvents(service, "executor", {
      ...KEY,
      attemptId: "foreign",
    }),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  await expect(
    readPlanSessionEvents(service, "executor", { ...KEY, planId: "other" }),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
});

it("paginates a legacy record honestly and respects its exclusive upper bound", async () => {
  const { service } = await world({ isLegacy: true });
  const first = await readPlanSessionEvents(service, "executor", {
    ...KEY,
    attemptId: "old:node",
    limit: 1,
  });
  expect(first).toMatchObject({
    sessionEvents: {
      history: {
        source: "legacy_record",
        cursor: 1,
        hasMore: true,
        events: [{ text: "first" }],
      },
    },
  });
  const second = await readPlanSessionEvents(service, "executor", {
    ...KEY,
    attemptId: "old:node",
    after: 1,
    before: 3,
    limit: 1,
  });
  expect(second).toMatchObject({
    sessionEvents: {
      history: { cursor: 2, hasMore: false, events: [{ text: "second" }] },
    },
  });
});

it.each([
  { limit: 0 },
  { limit: 33 },
  { after: -1 },
  { after: 1.5 },
  { after: 2, before: 2 },
  { unknown: true },
])("rejects malformed history parameters %j before reading", async (fields) => {
  const history = vi.fn<AgentSessionService["history"]>();
  await expect(
    readPlanSessionEvents({ history }, "executor", { ...KEY, ...fields }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(history).not.toHaveBeenCalled();
});

it("filters historical credentials and binds chunks to the exact event window", async () => {
  const { service, journal } = await world();
  await journal.append("attempt", [
    { kind: "agent_message", text: "λ".repeat(3000), turn: 1 },
  ]);
  const first = await readPlanSessionEvents(service, "executor", {
    ...KEY,
    maxBytes: 1024,
    before: 2,
  });
  if (!("chunk" in first)) throw new Error("Expected bounded chunk");
  expect(first.chunk.nextCursor).not.toBeNull();
  await expect(
    readPlanSessionEvents(service, "executor", {
      ...KEY,
      maxBytes: 1024,
      before: 3,
      cursor: first.chunk.nextCursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  const history = vi.fn<AgentSessionService["history"]>(async () => ({
    events: [
      {
        id: "attempt:1",
        sequence: 1,
        stepId: "node",
        attemptId: "attempt",
        turn: 1,
        kind: "error",
        createdAt: "2026-10-28T00:00:00Z",
        text: "password=synthetic-sensitive",
        isTruncated: false,
      },
    ],
    cursor: 1,
    hasMore: false,
    retainedFrom: null,
    source: "legacy_record",
  }));
  const filtered = await readPlanSessionEvents({ history }, "executor", KEY);
  expect(filtered).toMatchObject({ sessionEvents: { isFiltered: true } });
  expect(JSON.stringify(filtered)).not.toContain("synthetic-sensitive");
});

it("refuses a run-scoped identity before accessing session evidence", async () => {
  const plans = new PlanWorld();
  await expect(
    plans.operations.handle(
      {
        ...plans.identity("owner"),
        run: {
          runId: "run",
          stepId: "step",
          operations: [],
          tickets: [],
          reach: "full",
        },
      },
      "plans.run.session.events.read",
      KEY,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("reads only a retry named by the authorized run and bound to its stored owner and node", async () => {
  const { service, store, journal } = await world({ hasRetry: true });
  const original = await store.findAttempt("attempt");
  if (!original) throw new Error("Missing fixture attempt");
  const key = { ...KEY, attemptId: "previous" };
  await expect(
    readPlanSessionEvents(service, "executor", key),
  ).rejects.toMatchObject({ code: "plan_history_unavailable" });
  await store.saveAttempt({ ...original, key, userId: "foreign" });
  await expect(
    readPlanSessionEvents(service, "executor", key),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  await store.saveAttempt({ ...original, key });
  await journal.append("previous", [
    { kind: "error", text: "Original provider failure", turn: 1 },
  ]);
  expect(await readPlanSessionEvents(service, "executor", key)).toMatchObject({
    sessionEvents: {
      key,
      history: {
        events: [{ attemptId: "previous", text: "Original provider failure" }],
      },
    },
  });
  await expect(service.view("executor", key)).rejects.toMatchObject({
    code: "plan_access_denied",
  });
});

it("names an unavailable retained journal in the public operation failure", () => {
  expect(
    translatePlanError(new AgentError("plan_history_unavailable")),
  ).toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "plan_history_unavailable" },
  });
});
