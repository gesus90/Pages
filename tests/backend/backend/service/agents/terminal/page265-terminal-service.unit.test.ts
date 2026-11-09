import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentTerminalService } from "@/backend/service/agents/terminal/AgentTerminalService";

import {
  sessionRecord,
  sessionRun,
  sessionStep,
} from "../page85-session-fixture";

import type {
  AgentTerminalRecord,
  TerminalViewStore,
} from "@/backend/agents/terminal/TerminalStore";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentTerminalInput } from "@/definition/AgentTerminal";

const KEY = {
  planId: "plan-1",
  runId: "run-1",
  stepId: "writer",
  attemptId: "attempt-1",
};

function terminalRecord(
  overrides: Partial<AgentTerminalRecord> = {},
): AgentTerminalRecord {
  return {
    instanceId: "process",
    runId: "run-1",
    stepId: "writer",
    provider: "claude_code",
    state: "running",
    columns: 120,
    rows: 36,
    isAlternateScreen: true,
    screen: "\u001b[?1049hscreen",
    screenSequence: 4,
    nextSequence: 7,
    retainedFrom: 1,
    activeStepId: "writer",
    question: null,
    startedAt: "2026-11-08T10:00:00.000Z",
    updatedAt: "2026-11-08T10:01:00.000Z",
    endedAt: null,
    ...overrides,
  };
}

/** A store that keeps the queued inputs and the manual marks it was given. */
function memoryStore(terminal: AgentTerminalRecord): TerminalViewStore & {
  readonly queued: AgentTerminalInput[];
  readonly marked: string[];
} {
  const queued: AgentTerminalInput[] = [];
  const marked: string[] = [];
  const segments = [5, 6].map((sequence) => ({
    sequence,
    chunk: `part ${sequence}`,
  }));
  return {
    queued,
    marked,
    find: async (instanceId) =>
      instanceId === terminal.instanceId ? terminal : null,
    after: async (instanceIdOfQuery, after) =>
      segments.filter((segment) => segment.sequence > after),
    latest: async () => segments,
    before: async (instanceIdOfQuery, before) =>
      before === 5 ? [{ sequence: 3, chunk: "older" }] : [],
    enqueue: async (instanceIdOfQuery, userIdOfInput, input) => {
      queued.push(input);
    },
    markManualInput: async (runId) => {
      marked.push(runId);
    },
    removeRun: async () => undefined,
  };
}

function world(input: {
  readonly run?: Partial<AgentPlanRun>;
  readonly terminal?: Partial<AgentTerminalRecord>;
  readonly canEdit?: boolean;
}): {
  readonly service: AgentTerminalService;
  readonly store: ReturnType<typeof memoryStore>;
} {
  const run = sessionRun(
    [
      sessionStep(
        "writer",
        sessionRecord({ attemptId: "attempt-1", instanceId: "process" }),
      ),
    ],
    input.run,
  );
  const store = memoryStore(terminalRecord(input.terminal));
  const service = new AgentTerminalService({
    runs: {
      run: vi.fn(async (userId: string) => {
        if (userId !== run.userId) throw new AgentError("plan_access_denied");
        return run;
      }),
      stop: vi.fn(async () => run),
    },
    plans: { require: async () => ({ canEdit: input.canEdit ?? true }) },
    store,
    signals: { subscribe: () => () => undefined },
  });
  return { service, store };
}

it("opens a full-screen CLI with its screen and the segments after it", async () => {
  const { service } = world({});
  const opening = await service.open("executor", KEY);
  expect(opening.screen).toBe("\u001b[?1049hscreen");
  expect(opening.screenSequence).toBe(4);
  expect(opening.segments.map((segment) => segment.sequence)).toEqual([5, 6]);
  expect(opening.state.canInput).toBe(true);
  expect(opening.hasOlder).toBe(false);
});

it("opens an ordinary CLI with its last share and pages older segments", async () => {
  const { service } = world({
    terminal: { isAlternateScreen: false, retainedFrom: 2 },
  });
  const opening = await service.open("executor", KEY);
  expect(opening.screen).toBeNull();
  expect(opening.hasOlder).toBe(true);
  const page = await service.older("executor", KEY, 5);
  expect(page.segments).toEqual([{ sequence: 3, chunk: "older" }]);
  expect(page.hasOlder).toBe(true);
});

it("queues the input of a person who may run the plan and marks the run", async () => {
  const { service, store } = world({});
  await service.send("executor", KEY, { type: "input", data: "/model\r" });
  await service.send("executor", KEY, {
    type: "resize",
    columns: 100,
    rows: 30,
  });
  expect(store.queued).toEqual([
    { kind: "data", text: "/model\r" },
    { kind: "resize", columns: 100, rows: 30 },
  ]);
  // A resize alone is no intervention.
  expect(store.marked).toEqual(["run-1"]);
});

it("refuses input without the right to run the plan, also on a direct request", async () => {
  const { service, store } = world({ canEdit: false });
  expect((await service.open("executor", KEY)).state.canInput).toBe(false);
  await expect(
    service.send("executor", KEY, { type: "paste", text: "rm -rf" }),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  await expect(service.open("someone-else", KEY)).rejects.toMatchObject({
    code: "plan_access_denied",
  });
  expect(store.queued).toEqual([]);
});

it("takes no input once the CLI or the run has ended", async () => {
  for (const setup of [
    { terminal: { state: "ended" as const } },
    { run: { status: "failed" as const } },
  ]) {
    const { service, store } = world(setup);
    await expect(
      service.send("executor", KEY, { type: "interrupt" }),
    ).rejects.toMatchObject({ code: "plan_terminal_unavailable" });
    expect(store.queued).toEqual([]);
  }
});

it("reads nothing of a terminal that belongs to another run", async () => {
  const { service } = world({ terminal: { runId: "run-2" } });
  await expect(service.open("executor", KEY)).rejects.toMatchObject({
    code: "plan_terminal_unavailable",
  });
});

it("follows new segments once and reports the state", async () => {
  const { service } = world({});
  const events: unknown[] = [];
  const stop = await service.follow("executor", KEY, 5, (event) =>
    events.push(event),
  );
  await vi.waitFor(() => expect(events).toHaveLength(2));
  expect(events[0]).toEqual({ kind: "output", sequence: 6, chunk: "part 6" });
  expect(events[1]).toMatchObject({ kind: "state", state: { canInput: true } });
  stop();
});
