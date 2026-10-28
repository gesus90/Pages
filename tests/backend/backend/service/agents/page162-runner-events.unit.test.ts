import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { applyRunnerPlanEvent } from "@/backend/service/runner/RunnerPlanEvents";
import { runnerPlanCheckpoint } from "@/backend/service/runner/RunnerPlanCheckpoint";
import {
  progressStore,
  remoteCompletion,
} from "./page171-remote-acceptance-fixture";

vi.mock(
  "@/backend/database/repositories/agent/AgentPlanCheckpointRepository",
  () => ({
    AgentPlanCheckpointRepository: class {
      public append = vi.fn(async () => undefined);
    },
  }),
);

it("keeps gated remote exit zero provisional until the engine has checked the ticket", async () => {
  const world = await remoteCompletion(true);
  const result = applyRunnerPlanEvent(world, world.run, world.snapshot);
  expect(result.run.steps[0]).toMatchObject({
    status: "running",
    remote: { status: "completed" },
    session: { resultCode: null },
  });
  expect(result.checkpoint).toBeUndefined();
});

it("fails closed after a detached remote completion instead of recording immutable success", async () => {
  const world = await remoteCompletion(true);
  const result = applyRunnerPlanEvent(
    { ...world, isDetached: true },
    world.run,
    world.snapshot,
  );
  expect(result.run.steps[0]).toMatchObject({
    status: "failed",
    error: "plan_work_gate_unavailable",
    session: { resultCode: -1 },
  });
  expect(result.checkpoint).toBeUndefined();
});

it("retains the successful diagnostic remote checkpoint without the explicit opt-in", async () => {
  const world = await remoteCompletion(false);
  const result = applyRunnerPlanEvent(world, world.run, world.snapshot);
  expect(result.run.steps[0]?.status).toBe("succeeded");
  expect(result.checkpoint?.stepId).toBe(world.job.plan?.stepId);
});

it("keeps a legacy CLI answer for diagnosis but does not release successors as a successful result", async () => {
  const world = await remoteCompletion(false);
  if (!world.job.execution || !world.event.result)
    throw new Error("Expected a synthetic remote completion");
  const job = {
    ...world.job,
    execution: { ...world.job.execution, resultPayloadVersion: undefined },
  };
  const output =
    'Remote host: synthetic\nRemote workspace: /synthetic\n\n{"status":"partial"}';
  const event = {
    ...world.event,
    job,
    result: { ...world.event.result, output },
  };
  const result = applyRunnerPlanEvent(
    { ...world, job, event },
    world.run,
    world.snapshot,
  );
  expect(result.run.steps[0]).toMatchObject({
    status: "failed",
    error: "plan_runner_payload_update_required",
    output,
    remote: { closeout: "confirmed" },
    session: { resultCode: -1 },
  });
  expect(result.checkpoint).toBeUndefined();
});

it("rejects another attempt before reading completion or granting any successor", async () => {
  const world = await remoteCompletion(true);
  if (!world.job.plan) throw new Error("Expected a bound job");
  const job = {
    ...world.job,
    plan: { ...world.job.plan, attemptId: randomUUID() },
  };
  expect(() =>
    applyRunnerPlanEvent({ ...world, job }, world.run, world.snapshot),
  ).toThrow("Runner attempt mismatch");
});

it("persists server acceptance after provisional remote success without replacing transport evidence", async () => {
  const world = await remoteCompletion(true);
  const provisional = applyRunnerPlanEvent(
    world,
    world.run,
    world.snapshot,
  ).run;
  const current = provisional.steps[0];
  if (!current?.session) throw new Error("Expected a remote session");
  const completed = {
    ...current,
    status: "succeeded" as const,
    session: {
      ...current.session,
      resultCode: 0 as const,
      acceptance: {
        verdict: "accepted" as const,
        todos: [],
        criteria: [],
        decisions: [],
        issues: [],
        summary: "Server confirmed current work",
      },
    },
  };
  const run = { ...provisional, steps: [completed] };
  const checkpoint = runnerPlanCheckpoint(run, world.snapshot, completed);
  const store = progressStore(provisional, world.snapshot);
  await store.repository.update(run, checkpoint);
  const parameters = store.execute.mock.calls[0]?.[1];
  if (typeof parameters?.view_json !== "string")
    throw new Error("Expected a persisted run");
  expect(readPlanRun(JSON.parse(parameters.view_json)).steps[0]).toMatchObject({
    status: "succeeded",
    remote: current.remote,
    output: current.output,
    session: { acceptance: { verdict: "accepted" } },
  });
});

it("persists the gate refusal as failed instead of leaving a completed remote process marked running", async () => {
  const world = await remoteCompletion(true);
  const provisional = applyRunnerPlanEvent(
    world,
    world.run,
    world.snapshot,
  ).run;
  const current = provisional.steps[0];
  if (!current?.session) throw new Error("Expected a remote session");
  const refused = {
    ...current,
    status: "failed" as const,
    error: "plan_work_gate_failed",
    session: { ...current.session, resultCode: -1 as const },
  };
  const store = progressStore(provisional, world.snapshot);
  await store.repository.update({ ...provisional, steps: [refused] });
  const parameters = store.execute.mock.calls[0]?.[1];
  if (typeof parameters?.view_json !== "string")
    throw new Error("Expected a persisted run");
  expect(readPlanRun(JSON.parse(parameters.view_json)).steps[0]).toMatchObject({
    status: "failed",
    error: "plan_work_gate_failed",
  });
});

it("refuses an engine completion with a mismatched remote attempt", async () => {
  const world = await remoteCompletion(true);
  const provisional = applyRunnerPlanEvent(
    world,
    world.run,
    world.snapshot,
  ).run;
  const current = provisional.steps[0];
  if (!current?.session || !current.execution)
    throw new Error("Expected a remote attempt");
  const completed = {
    ...current,
    status: "succeeded" as const,
    execution: { ...current.execution, attemptId: randomUUID() },
    session: {
      ...current.session,
      resultCode: 0 as const,
      acceptance: {
        verdict: "accepted" as const,
        todos: [],
        criteria: [],
        decisions: [],
        issues: [],
        summary: "Other attempt",
      },
    },
  };
  const run = { ...provisional, steps: [completed] };
  const store = progressStore(provisional, world.snapshot);
  await expect(
    store.repository.update(
      run,
      runnerPlanCheckpoint(run, world.snapshot, completed),
    ),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
  expect(store.execute).not.toHaveBeenCalled();
});
