import { expect, it, vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { stoppedPlanRun } from "@/backend/service/agents/AgentPlanStop";
import { AgentPlanRunCommands } from "@/backend/service/agents/AgentPlanRunCommands";
import {
  planPauseGate,
  forgetPlanPauseGate,
} from "@/backend/service/agents/AgentPlanPauseGate";

import { RunnerExecutionPause } from "@/backend/service/runner/RunnerExecutionPause";
import { applyRunnerPlanEvent } from "@/backend/service/runner/RunnerPlanEvents";

import {
  controlledRemoteService,
  progressStore,
  remoteCompletion,
} from "./page171-remote-acceptance-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";

import type { RunnerRecord } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerState } from "@/definition/RunnerProtocol";

it("persists reversible Pause and Resume for the same remote job before transport delivery", async () => {
  const world = await remoteCompletion(false);
  let record: RunnerRecord = {
    connectionId: world.connectionId,
    runnerId: "runner",
    tokenHash: "synthetic",
    connectionRevision: 1,
    state: {
      version: 1,
      sessionId: world.job.sessionId,
      sequence: 0,
      lastEventId: null,
      jobs: [{ ...world.job, status: "running" }],
    },
  };
  const saved: boolean[] = [];
  const checkpoint = vi.fn(
    async (_connectionId: string, state: RunnerState) => {
      record = { ...record, state };
    },
  );
  const control = new RunnerExecutionPause(
    { find: async () => record, checkpoint },
    new SerialQueue(),
    (_connection, reply) => {
      expect(reply.type).toBe("execution-pause");
      saved.push(record.state.jobs[0]?.isPaused === true);
    },
  );
  await control.request(world.connectionId, world.job.jobId, true);
  expect(record.state.jobs[0]?.isPaused).toBe(true);
  await control.request(world.connectionId, world.job.jobId, false);
  expect(record.state.jobs[0]?.isPaused).toBe(false);
  expect(record.state.jobs[0]?.jobId).toBe(world.job.jobId);
  expect(saved).toEqual([true, false]);
});

it("retains a completion racing Pause, while the run stays paused and dispatch remains closed", async () => {
  const world = await remoteCompletion(false);
  const paused = { ...world.run, status: "paused" as const };
  const completed = applyRunnerPlanEvent(world, paused, world.snapshot).run;
  expect(completed.status).toBe("paused");
  expect(completed.steps[0]?.remote?.status).toBe("completed");
});

it("releases workspace locks on Stop even while the original remote attempt has no cleanup proof", async () => {
  const world = await remoteCompletion(false);
  const store = progressStore(world.run, world.snapshot);
  await store.repository.update(stoppedPlanRun(world.run));
  expect(
    store.execute.mock.calls.some(([statement]) =>
      statement.includes("DELETE FROM agent_plan_workspace_locks"),
    ),
  ).toBe(true);
});

it("resumes an in-flight remote attempt without replacing its job, session or attempt identity", async () => {
  const world = await remoteCompletion(false);
  let current: AgentPlanRun = {
    ...world.run,
    steps: world.run.steps.map((step) => ({
      ...step,
      remote: {
        jobId: world.job.jobId,
        sessionId: world.job.sessionId,
        status: "running",
        closeout: "pending",
        startedAt: null,
        endedAt: null,
      },
    })),
  };
  const service = controlledRemoteService(world, "").service;
  vi.spyOn(service, "pause").mockResolvedValue();
  const resume = vi.spyOn(service, "resume").mockResolvedValue();
  const active: ActivePlanRun = {
    view: current,
    snapshot: world.snapshot,
    groupCloseout: "open",
    hasPersistenceFailure: false,
    controllers: new Map(),
    dispatched: new Set(["agent"]),
    executions: new Set(),
  };
  const commands = new AgentPlanRunCommands({
    active: new Map([[current.id, active]]),
    writes: new SerialQueue(),
    isClosing: () => false,
    pump: vi.fn(),
    runs: {
      create: vi.fn(),
      insert: vi.fn(),
      find: async () => current,
      update: async (run) => {
        current = run;
      },
    },
    steps: { run: vi.fn(), closeGroups: vi.fn() },
    start: { control: vi.fn() },
    remoteExecution: service,
  });
  const original = current.steps[0];
  await commands.pause(current.id);
  expect(current.status).toBe("paused");
  await commands.resume(current.id, world.snapshot);
  expect(current.status).toBe("running");
  expect(current.steps[0]?.execution).toEqual(original?.execution);
  expect(current.steps[0]?.remote).toEqual(original?.remote);
  expect(resume).toHaveBeenCalledOnce();
  planPauseGate(current.id).resume();
  forgetPlanPauseGate(current.id);
});
