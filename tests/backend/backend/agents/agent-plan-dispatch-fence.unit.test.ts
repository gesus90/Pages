import { expect, it } from "vitest";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { requirePlanDispatchFence } from "@/backend/agents/AgentPlanDispatchFence";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerPlanBinding } from "@/definition/RunnerProtocol";

const binding: RunnerPlanBinding = {
  runId: "run",
  planId: "plan",
  planRevision: 1,
  stepId: "step",
  attemptId: "attempt",
};
const run = partial<AgentPlanRun>({
  id: "run",
  planId: "plan",
  planRevision: 1,
  status: "running",
  stopRequested: false,
  steps: [{ id: "step", status: "running", execution: binding }],
});

it("admits only the current running attempt", () => {
  expect(() => requirePlanDispatchFence(run, binding)).not.toThrow();
  for (const changed of [
    { ...binding, runId: "other" },
    { ...binding, planId: "other" },
    { ...binding, planRevision: 2 },
    { ...binding, stepId: "other" },
    { ...binding, attemptId: "other" },
  ])
    expect(() => requirePlanDispatchFence(run, changed)).toThrow();
});

it("distinguishes durable pause and stop before dispatch", () => {
  expect(() =>
    requirePlanDispatchFence({ ...run, stopRequested: true }, binding),
  ).toThrow(AgentPlanCancelledError);
  expect(() =>
    requirePlanDispatchFence({ ...run, status: "paused" }, binding),
  ).toThrow(AgentPlanPausedError);
  expect(() =>
    requirePlanDispatchFence({ ...run, status: "pausing" }, binding),
  ).toThrow(AgentPlanPausedError);
  expect(() =>
    requirePlanDispatchFence({ ...run, status: "succeeded" }, binding),
  ).toThrow();
  expect(() =>
    requirePlanDispatchFence(
      partial<AgentPlanRun>({
        ...run,
        steps: [{ id: "step", status: "waiting", execution: binding }],
      }),
      binding,
    ),
  ).toThrow();
});
