import { expect, it, vi } from "vitest";

import { observeRemoteAttempt } from "@/backend/service/agents/AgentPlanRemoteObservation";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { RunnerJob } from "@/definition/RunnerProtocol";

const RUN = partial<AgentPlanRun>({
  id: "run",
  planId: "plan",
  steps: [
    {
      id: "step",
      execution: {
        planId: "plan",
        runId: "run",
        stepId: "step",
        planRevision: 1,
        attemptId: "attempt",
        target: { kind: "remote", connectionId: "connection" },
      },
    },
  ],
});
const REMOTE = partial<RemotePlanStep>({ step: { id: "step" } });
const JOB = partial<RunnerJob>({
  jobId: "job",
  plan: {
    planId: "plan",
    runId: "run",
    stepId: "step",
    planRevision: 1,
    attemptId: "attempt",
  },
});

it("observes the original attempt and closes its Pages access before settlement", async () => {
  const close = vi.fn(async () => {});
  const settle = vi.fn(async () => ({ status: "succeeded" }));
  const result = await observeRemoteAttempt(
    RUN,
    REMOTE,
    partial({
      runners: { progress: async () => JOB },
      wait: async () => ({ status: "running" }),
      pages: { close },
      settle,
    }),
  );
  expect(result).toEqual({ status: "succeeded" });
  expect(close).toHaveBeenCalledWith("run", "step", "attempt");
  expect(settle).toHaveBeenCalledWith({ status: "running" }, "attempt");
});

it("refuses a changed job and still closes access if waiting fails", async () => {
  const close = vi.fn(async () => {});
  const settle = vi.fn();
  const base = partial<Parameters<typeof observeRemoteAttempt>[2]>({
    runners: { progress: async () => JOB },
    pages: { close },
    settle,
    wait: async () => {
      throw new Error("offline");
    },
  });
  await expect(
    observeRemoteAttempt(RUN, REMOTE, {
      ...base,
      runners: { progress: async () => undefined },
    }),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
  expect(close).not.toHaveBeenCalled();
  await expect(observeRemoteAttempt(RUN, REMOTE, base)).rejects.toThrow(
    "offline",
  );
  expect(close).toHaveBeenCalledOnce();
  expect(settle).not.toHaveBeenCalled();
});
