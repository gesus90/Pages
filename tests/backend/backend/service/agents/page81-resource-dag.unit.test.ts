import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";

import { groupEngine, groupTurn } from "./page73-group-fixture";
import {
  deferred,
  nativeSession,
  owner,
  resourceWorld,
} from "./page81-resource-fixture";
import { parameterRunFixture } from "./page55-run-fixture";

import type {
  PlanExecution,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanRun } from "@/definition/AgentPlan";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("preserves group acceptance and DAG dependencies while two other plans wait globally; reuse cannot deadlock behind them", async () => {
  const resources = resourceWorld();
  await resources.scheduler.recover();
  const initial = deferred<PlanSessionTurn>();
  const continuation = deferred<PlanSessionTurn>();
  const next = vi.fn(async () => continuation.promise);
  const start = vi.fn(async () => ({
    turn: initial.promise,
    next,
    close: nativeSession().close,
  }));
  const execution: PlanExecution = {
    run: async () => {
      throw new Error("No API in group");
    },
    open: (input, signal) =>
      resources.scheduler.open(
        {
          ...owner(input.instanceId),
          runId: input.resourceContext?.runId ?? null,
        },
        signal,
        start,
      ),
  };
  const world = await groupEngine(execution, resources.scheduler);
  const first = await world.engine.start("owner", world.snapshot);
  await vi.advanceTimersByTimeAsync(0);
  await world.engine.pause(first.id);
  const other = await world.engine.start("owner", {
    ...world.snapshot,
    plan: { ...world.snapshot.plan, id: "other-plan" },
  });
  const third = await world.engine.start("owner", {
    ...world.snapshot,
    plan: { ...world.snapshot.plan, id: "third-plan" },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(start).toHaveBeenCalledOnce();
  expect(resources.scheduler.snapshot().waiting).toHaveLength(2);
  initial.resolve(groupTurn());
  await vi.advanceTimersByTimeAsync(0);
  expect(next).not.toHaveBeenCalled();
  expect(resources.scheduler.snapshot().active[0]?.state).toBe("idle");
  expect(
    world.stored.get(first.id)?.steps.find((step) => step.id === "end")?.status,
  ).toBe("paused");
  await world.engine.resume(first.id);
  await vi.advanceTimersByTimeAsync(0);
  expect(next).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
  await world.engine.stop(other.id);
  await world.engine.stop(third.id);
  continuation.resolve(groupTurn());
  await vi.advanceTimersByTimeAsync(1000);
  expect(world.stored.get(first.id)?.status).toBe("succeeded");
  expect(world.stored.get(other.id)?.status).toBe("cancelled");
  expect(world.stored.get(third.id)?.status).toBe("cancelled");
  expect(start).toHaveBeenCalledOnce();
  await world.engine.shutdown();
  await resources.scheduler.shutdown();
});

it("keeps a non-ACP DAG branch runnable while three ACP branches await RAM; abort never starts them", async () => {
  const resources = resourceWorld();
  resources.memory.mockResolvedValue(512);
  await resources.scheduler.recover();
  const fixture = await parameterRunFixture();
  const steps = ["one", "two", "three", "api"].map((id) => ({
    ...fixture.step,
    step: { ...fixture.step.step, id },
    provider: id === "api" ? ("openrouter" as const) : ("codex_cli" as const),
  }));
  const snapshot = {
    ...fixture.snapshot,
    steps,
    plan: { ...fixture.snapshot.plan, nodes: steps.map((step) => step.step) },
  };
  const stored = new Map<string, AgentPlanRun>();
  const api = vi.fn(async () => "api-result");
  const native = vi.fn(async () => nativeSession());
  const engine = new AgentPlanRunEngine({
    resources: resources.scheduler,
    runs: {
      create: async (run) => {
        stored.set(run.id, run);
      },
      insert: async () => {},
      update: async (run) => {
        stored.set(run.id, run);
      },
      find: async (id) => stored.get(id) ?? null,
    },
    start: { control: async () => {} },
    steps: {
      closeGroups: async () => {},
      run: async (run, currentSnapshot, step, control) => {
        expect(currentSnapshot.steps).toContain(step);
        if (step.provider === "openrouter")
          return { status: "succeeded", output: await api() };
        try {
          await resources.scheduler.open(
            { ...owner(step.step.id), runId: run.id },
            control.signal,
            native,
          );
          throw new Error("RAM should prevent start");
        } catch {
          return { status: "cancelled", cancellation: "not_started" };
        }
      },
    },
  });
  const run = await engine.start("owner", snapshot);
  await vi.advanceTimersByTimeAsync(1000);
  expect(api).toHaveBeenCalledOnce();
  expect(
    stored.get(run.id)?.steps.find((step) => step.id === "api")?.status,
  ).toBe("succeeded");
  expect(resources.scheduler.snapshot().waiting).toHaveLength(3);
  expect(native).not.toHaveBeenCalled();
  await engine.stop(run.id);
  await vi.advanceTimersByTimeAsync(0);
  expect(stored.get(run.id)?.status).toBe("cancelled");
  expect(resources.scheduler.snapshot().waiting).toEqual([]);
  await engine.shutdown();
  await resources.scheduler.shutdown();
});

it("bounds shutdown of an unresponsive execution without pretending its run or reservations ended", async () => {
  const fixture = await parameterRunFixture();
  const stored = new Map<string, AgentPlanRun>();
  const engine = new AgentPlanRunEngine({
    runs: {
      create: async (run) => {
        stored.set(run.id, run);
      },
      insert: async () => {},
      update: async (run) => {
        stored.set(run.id, run);
      },
      find: async (id) => stored.get(id) ?? null,
    },
    start: { control: async () => {} },
    steps: {
      run: async () => new Promise<never>(() => {}),
      closeGroups: async () => {},
    },
  });
  const run = await engine.start("owner", fixture.snapshot);
  const stopping = engine.shutdown();
  const rejection = expect(stopping).rejects.toThrow(
    "reservations remain held",
  );
  await vi.advanceTimersByTimeAsync(30000);
  await rejection;
  expect(stored.get(run.id)?.status).toBe("stopping");
  // A shutdown interrupts the run; it is no stop decision of the executor.
  expect(stored.get(run.id)?.stopRequested).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
