import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanStartupRecovery } from "@/backend/service/agents/recovery/AgentPlanStartupRecovery";
import { createPlanCheckpoint } from "@/backend/service/agents/recovery/AgentPlanCheckpoint";

import { deferred } from "./page81-resource-fixture";
import { RecoveryDatabase } from "./page84-recovery-database";
import { patchRecoveryStep, recoveryFixture } from "./page84-recovery-fixture";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RecoveryFixture } from "./page84-recovery-fixture";

interface EngineWorld {
  readonly engine: AgentPlanRunEngine;
  readonly database: RecoveryDatabase;
  readonly calls: string[];
  readonly fixture: RecoveryFixture;
  readonly first: ReturnType<typeof deferred<void>>;
}

async function engineWorld(shouldFailSecond: boolean): Promise<EngineWorld> {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot);
  const calls: string[] = [];
  const first = deferred<void>();
  const engine = new AgentPlanRunEngine({
    runs: new AgentPlanRunRepository(database.asDatabase()),
    start: { control: async () => {} },
    steps: {
      closeGroups: async () => {},
      run: async (run, snapshot, step, control) => {
        expect(snapshot).toBe(fixture.snapshot);
        calls.push(step.step.id);
        if (step.step.id === "a") await first.promise;
        if (control.signal.aborted)
          return { status: "cancelled", cancellation: "confirmed" };
        if (step.step.id === "b" && shouldFailSecond)
          return {
            status: "failed",
            error: "plan_group_acceptance_failed",
            output: "B needs repair",
          };
        return { status: "succeeded", output: `${step.step.id} result` };
      },
    },
  });
  return { engine, database, calls, fixture, first };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("A → B → C checkpoints A, marks B recoverable and never starts C or replays A", async () => {
  const world = await engineWorld(true);
  const run = await world.engine.start("owner", world.fixture.snapshot);
  world.first.resolve();
  await vi.advanceTimersByTimeAsync(0);
  const persisted = world.database.run(run.id);
  const checkpoints = new AgentPlanCheckpointRepository(
    world.database.asDatabase(),
  );

  expect(world.calls).toEqual(["a", "b"]);
  expect(persisted).toMatchObject({
    status: "failed",
    stopRequested: false,
    recovery: { state: "recoverable", requiresReconciliation: true },
  });
  expect(persisted.steps[0]).toMatchObject({
    status: "succeeded",
    output: "a result",
  });
  expect(persisted.steps[2]).toMatchObject({
    status: "waiting",
    isBlocked: true,
  });
  expect(await checkpoints.find(run.id)).toMatchObject({
    stepId: "a",
    version: 1,
    result: { output: "a result" },
  });
  await expect(world.engine.resume(run.id)).rejects.toMatchObject({
    code: "plan_run_unavailable",
  });
  expect(world.calls).toEqual(["a", "b"]);
  await world.engine.shutdown();
});

it("preserves live pause/resume semantics and checkpoints every successful original node once", async () => {
  const world = await engineWorld(false);
  const run = await world.engine.start("owner", world.fixture.snapshot);
  await world.engine.pause(run.id);
  world.first.resolve();
  await vi.advanceTimersByTimeAsync(0);

  expect(world.calls).toEqual(["a"]);
  expect(world.database.run(run.id)).toMatchObject({
    status: "paused",
    steps: [
      { id: "a", status: "succeeded" },
      { id: "b", status: "paused" },
      { id: "c", status: "paused" },
    ],
  });
  await Promise.all([world.engine.resume(run.id), world.engine.resume(run.id)]);
  await vi.advanceTimersByTimeAsync(0);

  expect(world.calls).toEqual(["a", "b", "c"]);
  expect(world.database.run(run.id).status).toBe("succeeded");
  expect(
    world.database.stored().checkpoints.map((checkpoint) => checkpoint.stepId),
  ).toEqual(["a", "b", "c"]);
  await world.engine.shutdown();
});

it("quarantines an uncertain completion after a crash window and starts no dependent work or retry", async () => {
  const world = await engineWorld(false);
  const run = await world.engine.start("owner", world.fixture.snapshot);
  vi.spyOn(console, "error").mockImplementation(() => {});
  world.database.failNext("progress");
  world.first.resolve();
  await vi.advanceTimersByTimeAsync(0);

  expect(world.calls).toEqual(["a"]);
  expect(world.database.stored().checkpoints).toHaveLength(0);
  expect(world.database.run(run.id).steps[0].status).toBe("running");
  expect(world.database.run(run.id).stopRequested).toBe(false);
  await expect(world.engine.resume(run.id)).rejects.toMatchObject({
    code: "plan_run_unavailable",
  });
  expect(world.calls).toEqual(["a"]);
  await world.engine.shutdown();
});

it("an explicit stop cancels waiting successors and prevents later live resume", async () => {
  const world = await engineWorld(false);
  const run = await world.engine.start("owner", world.fixture.snapshot);
  await world.engine.stop(run.id);
  world.first.resolve();
  await vi.advanceTimersByTimeAsync(0);

  expect(world.calls).toEqual(["a"]);
  expect(world.database.run(run.id)).toMatchObject({
    status: "cancelled",
    stopRequested: true,
    steps: [
      { status: "cancelled" },
      { status: "cancelled", cancellation: "not_started" },
      { status: "cancelled", cancellation: "not_started" },
    ],
  });
  await expect(world.engine.resume(run.id)).rejects.toMatchObject({
    code: "plan_run_unavailable",
  });
  await world.engine.shutdown();
});

async function interruptedRun(wasStopped: boolean): Promise<{
  readonly fixture: RecoveryFixture;
  readonly database: RecoveryDatabase;
  readonly run: AgentPlanRun;
}> {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const runs = new AgentPlanRunRepository(database.asDatabase());
  await runs.update(
    fixture.completed,
    createPlanCheckpoint(fixture.completed, fixture.snapshot, "a"),
  );
  const session = fixture.completed.steps[0].session;
  const run: AgentPlanRun = {
    ...patchRecoveryStep(fixture.completed, "b", {
      status: "running",
      session: session
        ? {
            ...session,
            instanceId: "interrupted-owned-instance",
            closeout: "pending",
            resultCode: null,
          }
        : null,
    }),
    stopRequested: wasStopped,
  };
  await runs.update(run);
  return { fixture, database, run };
}

it("startup preserves A and its checkpoint, revokes MCP first and records interruption without inventing a user stop", async () => {
  const world = await interruptedRun(false);
  const runs = new AgentPlanRunRepository(world.database.asDatabase());
  const original = world.database.stored().checkpoints;
  const events: string[] = [];
  const recovery = new AgentPlanStartupRecovery({
    runs,
    sessions: {
      revoke: async () => {
        events.push("revoked");
        return 1;
      },
    },
    endSession: async (step): Promise<AgentPlanStepResult> => {
      events.push(step.id);
      if (step.session?.closeout !== "pending") return step;
      return {
        ...step,
        session: { ...step.session, closeout: "confirmed", resultCode: -1 },
      };
    },
    hasNoProcesses: async () => true,
  });

  await recovery.recover();
  const run = world.database.run("run");

  expect(events[0]).toBe("revoked");
  expect(run).toMatchObject({
    status: "failed",
    stopRequested: false,
    recovery: { state: "interrupted", requiresReconciliation: true },
  });
  expect(run.steps[0]).toEqual(world.run.steps[0]);
  expect(run.steps[1]).toMatchObject({
    status: "failed",
    error: "plan_interrupted",
    cancellation: "none",
  });
  expect(run.steps[2].isBlocked).toBe(true);
  expect(world.database.stored().checkpoints).toEqual(original);
  expect(world.database.stored().locks.size).toBe(0);
});

it("startup preserves explicit stop and retains reservations when tagged-process cleanup remains uncertain", async () => {
  const world = await interruptedRun(true);
  const recovery = new AgentPlanStartupRecovery({
    runs: new AgentPlanRunRepository(world.database.asDatabase()),
    endSession: async (step) =>
      step.session?.closeout === "pending"
        ? {
            ...step,
            session: { ...step.session, closeout: "failed", resultCode: -1 },
          }
        : step,
    hasNoProcesses: async () => false,
  });

  await recovery.recover();

  expect(world.database.run("run")).toMatchObject({
    status: "cancelled",
    stopRequested: true,
  });
  expect(world.database.run("run").recovery).toBeUndefined();
  expect(world.database.run("run").steps[1].session?.closeout).toBe("failed");
  expect(world.database.stored().locks.size).toBe(1);
});

it("startup never promotes a terminal branch because another branch was interrupted", async () => {
  const fixture = await recoveryFixture();
  const snapshot = {
    ...fixture.snapshot,
    plan: { ...fixture.snapshot.plan, edges: [] },
  };
  const prior = patchRecoveryStep(
    patchRecoveryStep(fixture.initial, "a", {
      status: "failed",
      error: "toString",
    }),
    "b",
    { status: "running" },
  );
  const database = new RecoveryDatabase(snapshot, prior);
  const recovery = new AgentPlanStartupRecovery({
    runs: new AgentPlanRunRepository(database.asDatabase()),
    endSession: async (step) => step,
    hasNoProcesses: async () => true,
  });

  await recovery.recover();

  expect(database.run("run").status).toBe("failed");
  expect(database.run("run").recovery).toBeUndefined();
  expect(database.run("run").steps[0].error).toBe("toString");
});

it("persists an independent successful branch after an uncertain completion without inventing a user stop", async () => {
  const fixture = await recoveryFixture();
  const side = {
    ...fixture.snapshot.steps[0],
    step: { ...fixture.snapshot.steps[0].step, id: "side" },
  };
  const snapshot = {
    ...fixture.snapshot,
    steps: [...fixture.snapshot.steps, side],
    plan: {
      ...fixture.snapshot.plan,
      nodes: [...fixture.snapshot.plan.nodes, side.step],
    },
  };
  const database = new RecoveryDatabase(snapshot);
  const first = deferred<void>();
  const independent = deferred<void>();
  const calls: string[] = [];
  const engine = new AgentPlanRunEngine({
    runs: new AgentPlanRunRepository(database.asDatabase()),
    start: { control: async () => {} },
    steps: {
      closeGroups: async () => {},
      run: async (run, currentSnapshot, step) => {
        calls.push(step.step.id);
        if (step.step.id === "a") await first.promise;
        if (step.step.id === "side") await independent.promise;
        return { status: "succeeded", output: step.step.id };
      },
    },
  });
  const run = await engine.start("owner", snapshot);
  vi.spyOn(console, "error").mockImplementation(() => {});
  database.failNext("progress");
  first.resolve();
  await vi.advanceTimersByTimeAsync(0);

  independent.resolve();
  await vi.advanceTimersByTimeAsync(0);
  const saved = database.run(run.id);

  expect(calls).toEqual(["a", "side"]);
  expect(saved.stopRequested).toBe(false);
  expect(saved.steps.find((step) => step.id === "a")?.status).toBe("running");
  expect(saved.steps.find((step) => step.id === "side")).toMatchObject({
    status: "succeeded",
    output: "side",
  });
  expect(saved.steps.find((step) => step.id === "b")?.status).toBe("waiting");
  expect(
    database.stored().checkpoints.map((checkpoint) => checkpoint.stepId),
  ).toEqual(["side"]);
  await engine.shutdown();
});
