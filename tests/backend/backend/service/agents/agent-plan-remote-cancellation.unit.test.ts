import { expect, it, vi } from "vitest";

import {
  isOriginalRemoteJob,
  pauseQueuedRemoteRun,
} from "@/backend/service/agents/AgentPlanRemoteCancellation";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerJob } from "@/definition/RunnerProtocol";

const EXECUTION = {
  planId: "plan",
  runId: "run",
  stepId: "step",
  attemptId: "attempt",
  planRevision: 2,
  target: { kind: "remote", connectionId: "connection" },
};
const STEP = partial<AgentPlanStepResult>({
  id: "step",
  execution: EXECUTION,
  remote: { jobId: "job", sessionId: "session" },
});
const RUN = partial<AgentPlanRun>({ id: "run", planId: "plan", steps: [STEP] });
const PLAN = {
  planId: "plan",
  runId: "run",
  stepId: "step",
  attemptId: "attempt",
  planRevision: 2,
};
const JOB = partial<RunnerJob>({
  jobId: "job",
  sessionId: "session",
  status: "queued",
  plan: PLAN,
});

it("matches both the attempt binding and recorded remote identity", () => {
  expect(isOriginalRemoteJob(RUN, STEP, JOB)).toBe(true);
  expect(isOriginalRemoteJob(RUN, STEP, { ...JOB, sessionId: "other" })).toBe(
    false,
  );
  expect(
    isOriginalRemoteJob(RUN, STEP, {
      ...JOB,
      plan: { ...PLAN, attemptId: "other" },
    }),
  ).toBe(false);
  expect(isOriginalRemoteJob(RUN, STEP, undefined)).toBe(false);
});

it("pauses only a still queued original job", async () => {
  const pauseQueued = vi.fn(async () => {});
  const progress = vi.fn(async () => JOB);
  const runners = { progress, pauseQueued };
  await pauseQueuedRemoteRun(RUN, runners);
  expect(pauseQueued).toHaveBeenCalledWith("connection", "job");
  await expect(pauseQueuedRemoteRun(RUN, { progress })).rejects.toMatchObject({
    code: "plan_runner_control_update_required",
  });
  await pauseQueuedRemoteRun(RUN, {
    progress: async () => ({ ...JOB, status: "running" }),
  });
});
