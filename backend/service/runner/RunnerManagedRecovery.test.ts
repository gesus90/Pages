import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planScriptRunSchema } from "@/backend/agents/AgentPlanScriptRunInput";
import { runnerJobSchema } from "@/definition/RunnerProtocol";

import { LOCAL_RUNNER_CONNECTION_ID } from "./LocalRunnerIdentity";
import { recoverManagedRunnerRun } from "./RunnerManagedRecovery";
import { projectManagedRunnerJob } from "./RunnerManagedProjection";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { PlanRunnerJob } from "@/definition/PlanRunnerJob";
import type { RunnerJob } from "@/definition/RunnerProtocol";

function fixture(
  closeout: PlanRunnerJob["closeout"],
  connectionId = randomUUID(),
): {
  run: AgentPlanRun;
  job: RunnerJob;
} {
  const reference: PlanRunnerJob = {
    connectionId,
    jobId: randomUUID(),
    attemptId: randomUUID(),
    stepId: "prepare",
    ownerStepId: "prepare",
    status: "failed",
    closeout,
  };
  const step: AgentPlanStepResult = {
    id: "prepare",
    name: "Prepare",
    status: "failed",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: "plan_script_cleanup",
    script: planScriptRunSchema.parse({
      runnerOwned: true,
      runnerJob: {
        connectionId: reference.connectionId,
        jobId: reference.jobId,
        attemptId: reference.attemptId,
      },
      attemptId: reference.attemptId,
      instanceId: randomUUID(),
      interpreterProfileId: "node",
      directory: "/fixture",
      userId: "executor",
      uid: 1000,
      gid: 1000,
      processId: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:01:00.000Z",
      exitCode: 0,
      signal: null,
      failure: "cleanup",
      closeout,
      stdout: "ready",
      stderr: "",
    }),
  };
  const run: AgentPlanRun = {
    id: randomUUID(),
    planId: randomUUID(),
    planName: "Fixture",
    planRevision: 1,
    userId: "executor",
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "failed",
    stopRequested: false,
    steps: [step],
    runnerJobs: [reference],
  };
  const job = runnerJobSchema.parse({
    jobId: reference.jobId,
    sessionId: randomUUID(),
    status: "failed",
    plan: {
      managed: true,
      runId: run.id,
      planId: run.planId,
      stepId: reference.stepId,
      ownerStepId: reference.ownerStepId,
      attemptId: reference.attemptId,
      planRevision: 1,
    },
    outcome: { closeout: "failed", output: null, exitCode: 0, signal: null },
  });
  return { run, job };
}

// Script ownership accepts only the identity fields, not the whole run reference.
function withScriptReference(run: AgentPlanRun): AgentPlanRun {
  return {
    ...run,
    steps: run.steps.map((step) => {
      if (!step.script?.runnerJob) return step;
      const { connectionId, jobId, attemptId } = step.script.runnerJob;
      return {
        ...step,
        script: {
          ...step.script,
          runnerJob: { connectionId, jobId, attemptId },
        },
      };
    }),
  };
}

describe("managed closeout recovery", () => {
  it.each([
    [LOCAL_RUNNER_CONNECTION_ID, "failed"],
    [LOCAL_RUNNER_CONNECTION_ID, "pending"],
    [randomUUID(), "failed"],
    [randomUUID(), "pending"],
  ] as const)(
    "never regresses confirmed evidence from %s to %s",
    async (connectionId, closeout) => {
      const { run, job } = fixture("confirmed", connectionId);
      const old = { ...job, outcome: { output: null, closeout } };
      let current = run;
      for (let attempt = 0; attempt < 4; attempt += 1)
        current = await recoverManagedRunnerRun(current, {
          progress: async () => old,
        });
      expect(current).toEqual(run);
    },
  );

  it.each(["failed", "pending"] as const)(
    "does not manufacture confirmation from %s",
    async (closeout) => {
      const { run, job } = fixture(closeout);
      const projected = await recoverManagedRunnerRun(run, {
        progress: async () => ({ ...job, outcome: { output: null, closeout } }),
      });
      expect(projected.runnerJobs?.[0]?.closeout).toBe(closeout);
      expect(projected.steps[0]?.script?.closeout).toBe(closeout);
    },
  );

  it("keeps confirmed unrelated claims when another job is projected", () => {
    const { run, job } = fixture("confirmed");
    const second = { ...job, jobId: randomUUID() };
    const projected = projectManagedRunnerJob(run, {
      connectionId: randomUUID(),
      job: second,
      isDetached: true,
    });
    expect(projected.runnerJobs).toHaveLength(2);
    expect(projected.runnerJobs?.[0]).toEqual(run.runnerJobs?.[0]);
  });
});

describe("managed job correlation and loop recovery", () => {
  it("never applies a foreign run's job to the source", () => {
    const { run, job } = fixture("confirmed");
    expect(
      projectManagedRunnerJob(run, {
        connectionId: run.runnerJobs?.[0]?.connectionId ?? "",
        job: { ...job, plan: job.plan && { ...job.plan, runId: randomUUID() } },
        isDetached: true,
      }),
    ).toBe(run);
  });

  it("never rebinds a confirmed job to another attempt", () => {
    const { run, job } = fixture("confirmed");
    expect(
      projectManagedRunnerJob(run, {
        connectionId: run.runnerJobs?.[0]?.connectionId ?? "",
        job: {
          ...job,
          plan: job.plan && { ...job.plan, attemptId: randomUUID() },
        },
        isDetached: true,
      }),
    ).toBe(run);
  });

  it("stays stable for loop member scripts as well as outer scripts", async () => {
    const { run: original, job } = fixture("confirmed");
    const run = withScriptReference(original);
    const loop: AgentPlanRun = {
      ...run,
      steps: [],
      loops: [
        {
          id: "loop",
          name: "Loop",
          status: "failed",
          count: null,
          sessionPolicy: "fresh",
          condition: null,
          iterations: [
            {
              id: "loop#1",
              number: 1,
              status: "failed",
              nodes: run.steps,
              startedAt: run.startedAt,
              endedAt: run.startedAt,
              condition: { state: "not_evaluated", reason: "incomplete" },
              error: "failed",
            },
          ],
          sessions: [],
          completion: null,
          cleanup: "confirmed",
          startedAt: run.startedAt,
          endedAt: run.startedAt,
          error: "failed",
        },
      ],
    };
    const recovered = await recoverManagedRunnerRun(loop, {
      progress: async () => job,
    });
    expect(recovered).toEqual(loop);
  });
});
