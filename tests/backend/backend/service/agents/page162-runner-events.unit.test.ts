import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { AgentPlanProgressRepository } from "@/backend/database/repositories/agent/AgentPlanProgressRepository";
import { capturePlanExecution } from "@/backend/service/agents/AgentPlanExecutionSnapshot";
import { remoteModelCommand } from "@/backend/service/agents/AgentPlanRemoteCommand";
import { applyRunnerPlanEvent } from "@/backend/service/runner/RunnerPlanEvents";
import { runnerPlanCheckpoint } from "@/backend/service/runner/RunnerPlanCheckpoint";

import { parameterRunFixture } from "./page55-run-fixture";
import { progressRun, progressStep } from "./page162-progress-fixture";
import { remoteTodoStep } from "./page162-remote-fixture";

import type { Mock } from "vitest";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RunnerJob, RunnerMessage } from "@/definition/RunnerProtocol";

vi.mock(
  "@/backend/database/repositories/agent/AgentPlanCheckpointRepository",
  () => ({
    AgentPlanCheckpointRepository: class {
      public append = vi.fn(async () => undefined);
    },
  }),
);

function progressStore(
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
): {
  readonly repository: AgentPlanProgressRepository;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const transaction: DatabaseTransaction = {
    query: vi.fn(async () => [
      [JSON.stringify(run), 1, JSON.stringify(snapshot)],
    ]),
    execute,
  };
  return {
    execute,
    repository: new AgentPlanProgressRepository({
      query: transaction.query,
      transaction: async (work) => work(transaction),
    }),
  };
}

async function remoteCompletion(hasGate: boolean): Promise<{
  readonly run: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly job: RunnerJob;
  readonly event: Extract<RunnerMessage, { type: "event" }>;
  readonly connectionId: string;
}> {
  const fixture = await parameterRunFixture();
  const step = {
    ...remoteTodoStep(),
    ...(hasGate
      ? { completionGate: { version: 1 as const, requiredChecks: ["focused"] } }
      : {}),
  };
  const target = {
    kind: "remote" as const,
    connectionId: randomUUID(),
    connectionRevision: 1,
    connectionName: "Controlled transport",
    workspaceId: randomUUID(),
    workspaceRevision: 1,
    workspaceName: "Synthetic remote workspace",
    path: "/synthetic-remote",
  };
  const command = remoteModelCommand(step, {
    version: 1,
    revision: 1,
    workspace: target.path,
    outputBytes: 65536,
    input: "{}",
  });
  const captured = capturePlanExecution(
    {
      ...progressRun([progressStep()]),
      id: randomUUID(),
      planId: fixture.snapshot.plan.id,
    },
    {
      plan: { ...fixture.snapshot.plan, nodes: [step], edges: [] },
      steps: [],
      remoteSteps: [{ step, target, command, inputs: {} }],
    },
  );
  const execution = captured.run.steps[0]?.execution;
  if (!execution) throw new Error("Expected a captured remote attempt");
  const job: RunnerJob = {
    jobId: randomUUID(),
    sessionId: randomUUID(),
    status: "completed",
    execution: command,
    plan: {
      runId: captured.run.id,
      planId: captured.run.planId,
      planRevision: captured.run.planRevision,
      stepId: step.id,
      attemptId: execution.attemptId,
    },
  };
  const event: Extract<RunnerMessage, { type: "event" }> = {
    version: 1,
    type: "event",
    eventId: randomUUID(),
    sequence: 1,
    sessionId: job.sessionId,
    job,
    result: {
      output: '{"status":"done","message":"Provider assertion"}',
      closeout: "confirmed",
      exitCode: 0,
      signal: null,
      reason: null,
    },
  };
  return {
    ...captured,
    run: readPlanRun(captured.run),
    job,
    event,
    connectionId: target.connectionId,
  };
}

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
