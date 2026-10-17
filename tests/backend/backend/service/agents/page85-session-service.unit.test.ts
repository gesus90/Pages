import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";

import {
  MemorySessionStore,
  sessionRecord,
  sessionRun,
  sessionStep,
} from "./page85-session-fixture";

import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const REPAIR = "Behebe den TypeScript-Buildfehler und prüfe erneut";
const KEY_A = {
  planId: "plan-1",
  runId: "run-1",
  stepId: "member-a",
  attemptId: "attempt-a",
};
const KEY_B = { ...KEY_A, stepId: "member-b", attemptId: "attempt-b" };

function groupRun(overrides: Partial<AgentPlanRun> = {}): AgentPlanRun {
  return sessionRun(
    [
      sessionStep(
        "member-a",
        sessionRecord({ attemptId: "attempt-a", instanceId: "process" }),
        { groupId: "group", status: "succeeded" },
      ),
      sessionStep(
        "member-b",
        sessionRecord({ attemptId: "attempt-b", instanceId: "process" }),
        { groupId: "group" },
      ),
      sessionStep(
        "legacy",
        sessionRecord({
          attemptId: undefined,
          instanceId: "old",
          events: ["session acp-1", "turn end_turn"],
        }),
        { status: "succeeded" },
      ),
    ],
    overrides,
  );
}

interface SessionWorld {
  readonly store: MemorySessionStore;
  readonly journal: AgentSessionJournal;
  readonly inbox: AgentSessionInbox;
  readonly runs: {
    readonly run: ReturnType<typeof vi.fn>;
    readonly stop: ReturnType<typeof vi.fn>;
  };
  readonly service: AgentSessionService;
  readonly listen: (stepId: string, groupId?: string) => AcpSessionListener;
}

function sessionWorld(run: { current: AgentPlanRun }): SessionWorld {
  const store = new MemorySessionStore();
  const journal = new AgentSessionJournal(store);
  const inbox = new AgentSessionInbox(store, journal);
  const runs = {
    run: vi.fn(async (userId: string, runId: string) => {
      if (userId !== run.current.userId || runId !== run.current.id)
        throw new AgentError("plan_access_denied");
      return run.current;
    }),
    stop: vi.fn(async () => run.current),
  };
  const service = new AgentSessionService({ runs, store, journal, inbox });
  function listen(stepId: string, groupId = "group"): AcpSessionListener {
    const step = run.current.steps.find((entry) => entry.id === stepId);
    const listener = service.listen(
      {
        run: run.current,
        step: { step: { id: stepId }, groupId },
        record: step?.session ?? null,
      },
      "process",
    );
    if (!listener) throw new Error("No listener");
    return listener;
  }
  return { store, journal, inbox, runs, service, listen };
}

function denial(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "none",
    (error: unknown) =>
      error instanceof AgentError ? error.code : "unexpected",
  );
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

it("records members of one process into separate attempts with their own turns and usage", async () => {
  const run = { current: groupRun() };
  const world = sessionWorld(run);
  const first = world.listen("member-a");
  first.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Ich prüfe " },
  });
  first.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "den Build." },
  });
  first.update({
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "pnpm build",
    kind: "execute",
  });
  first.update({
    sessionUpdate: "usage_update",
    used: 90_000,
    size: 200_000,
    _meta: { "_claude/model": "claude-opus-5-5-20261001" },
  });
  first.prompted({
    inputTokens: 112_000,
    outputTokens: 1_200,
    cachedReadTokens: 3_600_000,
    totalTokens: 3_713_200,
  });
  await world.service.settle(run.current.steps[0]?.session ?? null, {
    failure: null,
    errorCode: null,
  });
  // The next member continues the same process; its events and turns are its own.
  const second = world.listen("member-b");
  expect(second).toBe(first);
  second.update({
    sessionUpdate: "tool_call_update",
    toolCallId: "call-2",
    title: "tsc",
    status: "failed",
  });
  second.prompted(null);
  await world.service.settle(run.current.steps[1]?.session ?? null, {
    failure: "failed",
    errorCode: "plan_runner_failed",
  });
  const historyA = await world.service.history("executor", KEY_A, {
    after: 0,
    limit: 50,
  });
  const historyB = await world.service.history("executor", KEY_B, {
    after: 0,
    limit: 50,
  });
  expect(historyA.events.map((event) => [event.kind, event.turn])).toEqual([
    ["agent_message", 1],
    ["tool_started", 1],
    ["status", 1],
  ]);
  expect(historyA.events[0]?.text).toBe("Ich prüfe den Build.");
  expect(historyB.events.map((event) => [event.kind, event.turn])).toEqual([
    ["tool_failed", 1],
    ["status", 1],
    ["error", 2],
  ]);
  const viewA = await world.service.view("executor", KEY_A);
  expect(viewA.context).toMatchObject({
    contextUsed: 90_000,
    contextLimit: 200_000,
    percent: 45,
  });
  expect(viewA.model.confirmedModel).toMatchObject({
    value: "claude-opus-5-5-20261001",
    source: "acp_usage_report",
  });
  expect(viewA.turns).toHaveLength(1);
  expect(viewA.totals[0]).toMatchObject({
    inputTokens: 112_000,
    outputTokens: 1_200,
    cacheReadTokens: 3_600_000,
    inputIncludesCache: false,
  });
  const viewB = await world.service.view("executor", KEY_B);
  expect(viewB.state).toBe("failed");
  expect(viewB.turns).toEqual([]);
  // B reported no tokens: its own sums are empty, the run's sums hold A's turn once.
  expect(viewB.totals).toEqual([]);
  expect(viewB.runTotals).toMatchObject([{ turns: 1, inputTokens: 112_000 }]);
  // The shared native session's last occupancy holds for the next member, with its own time.
  expect(viewB.context.contextUsed).toBe(90_000);
  expect(viewB.model.confirmedModel.source).toBe("acp_usage_report");
});

it("rejects foreign readers and reads a legacy record without any process", async () => {
  const run = { current: groupRun() };
  const world = sessionWorld(run);
  expect(await denial(world.service.view("intruder", KEY_A))).toBe(
    "plan_access_denied",
  );
  expect(
    await denial(
      world.service.history(
        "executor",
        { ...KEY_A, runId: "run-2" },
        { after: 0, limit: 10 },
      ),
    ),
  ).toBe("plan_access_denied");
  const legacy = await world.service.history(
    "executor",
    { ...KEY_A, stepId: "legacy", attemptId: "old:legacy" },
    { after: 0, limit: 10 },
  );
  expect(legacy).toMatchObject({ source: "legacy_record", hasMore: false });
  expect(legacy.events.map((event) => event.text)).toEqual([
    "session acp-1",
    "turn end_turn",
  ]);
  const view = await world.service.view("executor", {
    ...KEY_A,
    stepId: "legacy",
    attemptId: "old:legacy",
  });
  expect(view.state).toBe("ended");
  expect(view.continuation).toMatchObject({
    mode: "unavailable",
    reason: "native_session_ended",
  });
  expect(view.actions).toMatchObject({ canSend: false, canRecover: false });
});

it("buffers an instruction during a running turn visibly and delivers it exactly once afterwards", async () => {
  const run = { current: groupRun() };
  const world = sessionWorld(run);
  world.listen("member-a");
  let active = 0;
  let overlapping = false;
  const delivered: string[] = [];
  const instruct = vi.fn(async (text: string) => {
    active += 1;
    overlapping ||= active > 1;
    await flush();
    delivered.push(text);
    active -= 1;
  });
  world.service.offer(
    { attemptId: "attempt-a", instanceId: "process" },
    {
      instruct,
      cancelTurn: async () => true,
    },
  );
  const [first, second] = await Promise.all([
    world.service.send("executor", KEY_A, {
      kind: "instruction",
      text: "Ergänze Tests",
    }),
    world.service.send("executor", KEY_A, {
      kind: "instruction",
      text: "und prüfe Lint",
    }),
  ]);
  expect(first.delivery).toBe("queued");
  expect(second.delivery).toBe("queued");
  expect(instruct).not.toHaveBeenCalled();
  const waiting = await world.service.view("executor", KEY_A);
  expect(waiting.messages.map((message) => message.status)).toEqual([
    "queued",
    "queued",
  ]);
  await world.service.settle(run.current.steps[0]?.session ?? null, {
    failure: null,
    errorCode: null,
  });
  await vi.waitFor(() => expect(delivered).toHaveLength(2));
  expect(delivered).toEqual(["Ergänze Tests", "und prüfe Lint"]);
  expect(overlapping).toBe(false);
  const done = await world.service.view("executor", KEY_A);
  expect(done.messages.map((message) => message.status)).toEqual([
    "delivered",
    "delivered",
  ]);
  // Another turn end delivers nothing twice.
  await world.service.settle(run.current.steps[0]?.session ?? null, {
    failure: null,
    errorCode: null,
  });
  await flush();
  expect(instruct).toHaveBeenCalledTimes(2);
});

it("sends a repair instruction after a failure and keeps the plan assignment and finished nodes", async () => {
  const run = { current: groupRun() };
  const world = sessionWorld(run);
  const pinned = run.current.steps[1]?.session?.contract;
  world.listen("member-b");
  await world.service.settle(run.current.steps[1]?.session ?? null, {
    failure: "failed",
    errorCode: "plan_runner_failed",
  });
  expect(
    await denial(
      world.service.send("executor", KEY_B, { kind: "repair", text: REPAIR }),
    ),
  ).toBe("plan_session_unavailable");
  const instruct = vi.fn(async () => undefined);
  world.service.offer(
    { attemptId: "attempt-b", instanceId: "process" },
    {
      instruct,
      cancelTurn: async () => false,
    },
  );
  const sent = await world.service.send("executor", KEY_B, {
    kind: "repair",
    text: REPAIR,
  });
  expect(sent.message).toMatchObject({ kind: "repair", text: REPAIR });
  await vi.waitFor(() => expect(instruct).toHaveBeenCalledWith(REPAIR));
  const history = await world.service.history("executor", KEY_B, {
    after: 0,
    limit: 50,
  });
  expect(
    history.events.some(
      (event) => event.kind === "repair_instruction" && event.text === REPAIR,
    ),
  ).toBe(true);
  expect(run.current.steps[1]?.session?.contract).toBe(pinned);
  expect(run.current.steps[0]?.status).toBe("succeeded");
  // A rights check before the native write stops a revoked executor.
  run.current = groupRun({ status: "cancelled" });
  expect(
    await denial(
      world.service.send("executor", KEY_B, { kind: "repair", text: REPAIR }),
    ),
  ).toBe("plan_run_unavailable");
});

it("cancels a turn apart from the run and marks lost deliveries as uncertain", async () => {
  const run = { current: groupRun() };
  const world = sessionWorld(run);
  world.listen("member-a");
  const cancelTurn = vi.fn(async () => true);
  world.service.offer(
    { attemptId: "attempt-a", instanceId: "process" },
    {
      instruct: async () => undefined,
      cancelTurn,
    },
  );
  expect(await world.service.cancel("executor", KEY_A, "turn")).toBe(
    "turn_cancelled",
  );
  expect(world.runs.stop).not.toHaveBeenCalled();
  expect(await world.service.cancel("executor", KEY_A, "run")).toBe(
    "run_stopped",
  );
  expect(world.runs.stop).toHaveBeenCalledWith("executor", "run-1");
  await world.store.saveMessage({
    id: "lost",
    attemptId: "attempt-a",
    userId: "executor",
    kind: "instruction",
    text: "half sent",
    status: "delivering",
    createdAt: "t",
    updatedAt: "t",
  });
  expect(await world.inbox.recover()).toBe(1);
  expect(world.store.messages.get("lost")?.status).toBe("uncertain");
  await world.service.released(run.current.steps[0]?.session ?? null);
  const view = await world.service.view("executor", KEY_A);
  expect(view.actions.canSend).toBe(false);
  expect(view.state).toBe("ended");
});

it("ends a failed start clearly: the turn mark clears and a waiting instruction fails once", async () => {
  const run = { current: groupRun() };
  const world = sessionWorld(run);
  world.listen("member-a");
  const instruct = vi.fn(async () => undefined);
  world.service.offer(
    { attemptId: "attempt-a", instanceId: "process" },
    { instruct },
  );
  const sent = await world.service.send("executor", KEY_A, {
    kind: "instruction",
    text: "Weiter",
  });
  expect(sent.delivery).toBe("queued");
  await world.service.abandon(run.current.steps[0]?.session ?? null, "failed");
  await vi.waitFor(async () =>
    expect(
      (await world.service.view("executor", KEY_A)).messages[0]?.status,
    ).toBe("failed"),
  );
  expect(instruct).not.toHaveBeenCalled();
  const view = await world.service.view("executor", KEY_A);
  expect(view.state).toBe("failed");
  expect(view.actions).toMatchObject({ canSend: false, canCancelTurn: false });
  const history = await world.service.history("executor", KEY_A, {
    after: 0,
    limit: 50,
  });
  expect(history.events.filter((event) => event.kind === "error")).toHaveLength(
    2,
  );
});
