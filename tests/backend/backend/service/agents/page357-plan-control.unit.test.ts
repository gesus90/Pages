import { afterEach, expect, it, vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanRunCommands } from "@/backend/service/agents/AgentPlanRunCommands";
import { preparePlanContinuation } from "@/backend/service/agents/AgentPlanContinuation";
import { planControl } from "@/backend/service/agents/AgentPlanControl";
import {
  planPauseGate,
  forgetPlanPauseGate,
} from "@/backend/service/agents/AgentPlanPauseGate";
import { runPausablePlanRequest } from "@/backend/service/agents/AgentPlanPausedRequest";

import {
  controlledRemoteService,
  remoteCompletion,
} from "./page171-remote-acceptance-fixture";
import {
  branchEngine,
  branchRuntime,
  branchReport,
} from "./page174-branching-fixture";
import {
  flow,
  stackEngine,
  stackReport,
  stackRuntime,
} from "./page175-stack-fixture";

import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";

afterEach(() => {
  vi.useRealTimers();
});

it("pauses immediately during a native turn, retains ownership and resumes the same turn three times", async () => {
  const runtime = branchRuntime({ check: [branchReport(true)] }, ["check"]);
  const world = await branchEngine(runtime.execution);
  const run = await world.engine.start("owner", world.snapshot);
  await expect.poll(() => runtime.calls.length).toBe(1);
  const session = world
    .read(run.id)
    .steps.find((step) => step.id === "check")?.session;
  for (let index = 0; index < 3; index += 1) {
    const began = Date.now();
    await world.engine.pause(run.id);
    expect(Date.now() - began).toBeLessThan(3000);
    expect(world.read(run.id).status).toBe("paused");
    expect(
      world.read(run.id).steps.find((step) => step.id === "check")?.session,
    ).toEqual(session);
    expect(runtime.closed).toEqual([]);
    expect(runtime.calls).toHaveLength(1);
    await world.engine.resume(run.id, world.snapshot);
    expect(world.read(run.id).id).toBe(run.id);
  }
  runtime.release("check");
  await expect.poll(() => world.read(run.id).status).toBe("succeeded");
  expect(runtime.calls).toHaveLength(1);
});

it("adopts edits for an unstarted agent while retaining the running session contract", async () => {
  const runtime = branchRuntime({ check: [branchReport(true)] }, ["check"]);
  const world = await branchEngine(runtime.execution);
  const run = await world.engine.start("owner", world.snapshot);
  await expect.poll(() => runtime.calls.length).toBe(1);
  await world.engine.pause(run.id);
  const proposed: AgentPlanSnapshot = {
    ...world.snapshot,
    steps: world.snapshot.steps.map((step) => ({
      ...step,
      name: `edited-${step.name}`,
    })),
  };
  const continuation = preparePlanContinuation(
    world.read(run.id),
    world.snapshot,
    proposed,
  );
  expect(
    continuation.snapshot.steps.find((step) => step.step.id === "check")?.name,
  ).toBe(world.snapshot.steps.find((step) => step.step.id === "check")?.name);
  expect(
    continuation.snapshot.steps.find((step) => step.step.id === "fix")?.name,
  ).toMatch(/^edited-/u);
  await world.engine.resume(run.id, proposed);
  runtime.release("check");
  await expect.poll(() => world.read(run.id).status).toBe("succeeded");
});

it("pauses in loop iteration two and continues that iteration in the same native session", async () => {
  const runtime = stackRuntime({
    work: [stackReport(), stackReport(), stackReport()],
  });
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let nextCalls = 0;
  const execution = {
    ...runtime.execution,
    open: async (...input: Parameters<typeof runtime.execution.open>) => {
      const session = await runtime.execution.open(...input);
      return {
        ...session,
        next: async (...next: Parameters<NonNullable<typeof session.next>>) => {
          nextCalls += 1;
          if (nextCalls === 1) await held;
          if (!session.next) throw new Error("Missing synthetic continuation");
          return session.next(...next);
        },
      };
    },
  };
  const world = await stackEngine(execution, {
    nodes: ({ plain }) => [
      { id: "start", type: "start", x: 0, y: 0 },
      {
        id: "loop",
        type: "loop",
        name: "Loop",
        x: 100,
        y: 0,
        steps: [plain("work")],
        edges: [],
        runs: 3,
        runsSource: "value",
        bindings: {},
        countMode: "expected",
        sessionPolicy: "reuse",
        condition: null,
      },
      { id: "end", type: "end", x: 200, y: 0 },
    ],
    edges: [flow("start", "loop"), flow("loop", "end")],
  });
  const run = await world.engine.start("owner", world.snapshot);
  await expect.poll(() => nextCalls).toBe(1);
  await world.engine.pause(run.id);
  expect(world.read(run.id).loops?.[0]?.iterations).toHaveLength(2);
  release();
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  expect(world.read(run.id).loops?.[0]?.iterations).toHaveLength(2);
  expect(runtime.closed).toEqual([]);
  await world.engine.resume(run.id, world.snapshot);
  await expect.poll(() => world.read(run.id).status).toBe("succeeded");
  expect(runtime.calls.filter((call) => call.kind === "open")).toHaveLength(1);
  expect(world.read(run.id).loops?.[0]?.iterations).toHaveLength(3);
});

it("aborts an API request on pause and repeats only that turn after resume", async () => {
  const runId = "page357-api";
  const request = vi.fn<(signal: AbortSignal) => Promise<string>>();
  request
    .mockImplementationOnce(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("interrupted")),
            { once: true },
          );
        }),
    )
    .mockResolvedValueOnce("done");
  const result = runPausablePlanRequest(
    runId,
    new AbortController().signal,
    request,
  );
  await expect.poll(() => request.mock.calls.length).toBe(1);
  planPauseGate(runId).pause();
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  expect(request).toHaveBeenCalledTimes(1);
  planPauseGate(runId).resume();
  await expect(result).resolves.toBe("done");
  expect(request).toHaveBeenCalledTimes(2);
  forgetPlanPauseGate(runId);
});

it("restores a paused run in a fresh engine and resumes its stored native identity", async () => {
  const runtime = branchRuntime({ check: [branchReport(true)] }, ["check"]);
  const world = await branchEngine(runtime.execution);
  const run = await world.engine.start("owner", world.snapshot);
  await expect.poll(() => runtime.calls.length).toBe(1);
  await world.engine.pause(run.id);
  const paused = world.read(run.id);
  await world.engine.shutdown();
  let stored = structuredClone(paused);
  const reattach = vi.fn(async (current: AgentPlanRun) => {
    expect(current.id).toBe(paused.id);
    expect(
      current.steps.find((step) => step.id === "check")?.session?.instanceId,
    ).toBe(
      paused.steps.find((step) => step.id === "check")?.session?.instanceId,
    );
    const session = current.steps.find((step) => step.id === "check")?.session;
    return {
      status: "succeeded" as const,
      output: "done",
      error: null,
      passed: true,
      ...(session
        ? {
            session: {
              ...session,
              closeout: "confirmed" as const,
              resultCode: 0 as const,
            },
          }
        : {}),
    };
  });
  const restored = new AgentPlanRunEngine({
    runs: {
      create: vi.fn(),
      insert: vi.fn(),
      update: async (current) => {
        stored = structuredClone(current);
      },
      find: async () => stored,
      snapshot: async () => world.snapshot,
    },
    steps: { run: reattach, closeGroups: vi.fn() },
    start: { control: vi.fn() },
  });
  expect(await restored.adopt(paused)).toBe(true);
  expect(reattach).not.toHaveBeenCalled();
  await restored.resume(run.id, world.snapshot);
  await expect.poll(() => stored.status).toBe("succeeded");
  expect(reattach).toHaveBeenCalledTimes(1);
});

it("Stop closes a paused run, releases its definitions and allows a fresh Start from the beginning", async () => {
  const runtime = branchRuntime(
    { check: [branchReport(true), branchReport(true)] },
    ["check"],
  );
  const world = await branchEngine(runtime.execution);
  const run = await world.engine.start("owner", world.snapshot);
  await expect.poll(() => runtime.calls.length).toBe(1);
  await world.engine.pause(run.id);
  const stopping = world.engine.stop(run.id);
  runtime.release("check");
  await stopping;
  expect(world.read(run.id).status).toBe("cancelled");
  await expect(world.engine.resume(run.id, world.snapshot)).rejects.toThrow();
  const fresh = await world.engine.start("owner", world.snapshot);
  expect(fresh.id).not.toBe(run.id);
  await expect.poll(() => world.read(fresh.id).status).toBe("succeeded");
  expect(runtime.calls).toHaveLength(2);
});

it("an offline remote cleanup cannot keep Stop open or its reservation held", async () => {
  vi.useFakeTimers();
  const base = await branchEngine(branchRuntime({}).execution);
  const remote = controlledRemoteService(
    await remoteCompletion(false),
    "",
  ).service;
  const remoteStop = vi
    .spyOn(remote, "stop")
    .mockImplementation(() => new Promise(() => undefined));
  let stored: AgentPlanRun = {
    id: "page357-offline",
    planId: base.plan.id,
    planName: base.plan.name,
    planRevision: 1,
    userId: "owner",
    startedAt: new Date().toISOString(),
    status: "pausing",
    stopRequested: false,
    steps: [],
  };
  let isReserved = true;
  const release = vi.fn(async () => undefined);
  const active: ActivePlanRun = {
    view: stored,
    snapshot: base.snapshot,
    controllers: new Map(),
    dispatched: new Set(),
    executions: new Set(),
    hasPersistenceFailure: false,
    groupCloseout: "open",
    releaseDefinition: release,
  };
  const activeRuns = new Map([[stored.id, active]]);
  const commands = new AgentPlanRunCommands({
    remoteExecution: remote,
    active: activeRuns,
    writes: new SerialQueue(),
    isClosing: () => false,
    pump: vi.fn(),
    runs: {
      create: vi.fn(),
      insert: vi.fn(),
      find: async () => stored,
      update: async (current) => {
        stored = current;
        if (current.stopRequested) isReserved = false;
      },
    },
    steps: { run: vi.fn(), closeGroups: () => new Promise(() => undefined) },
    start: { control: vi.fn() },
  });
  const pending = commands.stop(stored.id);
  await vi.advanceTimersByTimeAsync(7100);
  await pending;
  expect(stored.status).toBe("cancelled");
  expect(stored.controlError).toBe("plan_stop_unconfirmed");
  expect(remoteStop).toHaveBeenCalledOnce();
  expect(isReserved).toBe(false);
  expect(activeRuns.size).toBe(0);
  expect(release).toHaveBeenCalledOnce();
  const view: AgentPlanView = {
    ...base.plan,
    ownerId: "owner",
    canEdit: true,
    projectName: "Project",
    github: null,
  };
  const control = planControl(view, stored, {
    userId: "owner",
    hasReservation: false,
  });
  expect(control).toMatchObject({
    canResume: false,
    canPause: false,
    canStop: false,
    canPlay: true,
  });
});
