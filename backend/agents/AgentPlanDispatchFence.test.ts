import { describe, expect, it } from "vitest";

import { requirePlanDispatchFence } from "@/backend/agents/AgentPlanDispatchFence";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerPlanBinding } from "@/definition/RunnerProtocol";

function binding(overrides: Record<string, unknown> = {}): RunnerPlanBinding {
  return {
    runId: "run",
    planId: "plan",
    planRevision: 1,
    stepId: "step",
    attemptId: "attempt",
    managed: false,
    ...overrides,
  } as unknown as RunnerPlanBinding;
}

function step(overrides: Record<string, unknown> = {}): AgentPlanStepResult {
  return {
    id: "step",
    status: "running",
    execution: {
      runId: "run",
      planId: "plan",
      stepId: "step",
      planRevision: 1,
      attemptId: "attempt",
    },
    ...overrides,
  } as unknown as AgentPlanStepResult;
}

function run(overrides: Record<string, unknown> = {}): AgentPlanRun {
  return {
    id: "run",
    planId: "plan",
    planRevision: 1,
    status: "running",
    stopRequested: false,
    steps: [step()],
    ...overrides,
  } as unknown as AgentPlanRun;
}

function isStale(plan: AgentPlanRun, bound: RunnerPlanBinding): boolean {
  try {
    requirePlanDispatchFence(plan, bound);
  } catch (error) {
    return error instanceof AgentError && error.code === "plan_context_changed";
  }
  return false;
}

describe("requirePlanDispatchFence", () => {
  it("accepts a running attempt that matches the run", () => {
    expect(() => requirePlanDispatchFence(run(), binding())).not.toThrow();
  });

  it("refuses a stale attempt", () => {
    expect(isStale(run({ id: "other" }), binding())).toBe(true);
    expect(isStale(run({ planId: "other" }), binding())).toBe(true);
    expect(isStale(run({ planRevision: 2 }), binding())).toBe(true);
    expect(isStale(run({ steps: [] }), binding())).toBe(true);
    expect(
      isStale(run({ steps: [step({ execution: undefined })] }), binding()),
    ).toBe(true);
    for (const field of [
      "runId",
      "planId",
      "stepId",
      "planRevision",
      "attemptId",
    ])
      expect(
        isStale(
          run({
            steps: [
              step({
                execution: {
                  runId: "run",
                  planId: "plan",
                  stepId: "step",
                  planRevision: 1,
                  attemptId: "attempt",
                  [field]: "changed",
                },
              }),
            ],
          }),
          binding(),
        ),
      ).toBe(true);
  });

  it("separates a requested stop and a pause from a failure", () => {
    expect(() =>
      requirePlanDispatchFence(run({ stopRequested: true }), binding()),
    ).toThrow(AgentPlanCancelledError);
    for (const status of ["pausing", "paused"])
      expect(() =>
        requirePlanDispatchFence(run({ status }), binding()),
      ).toThrow(AgentPlanPausedError);
  });

  it("refuses a run or step that is not running", () => {
    expect(isStale(run({ status: "failed" }), binding())).toBe(true);
    expect(
      isStale(run({ steps: [step({ status: "waiting" })] }), binding()),
    ).toBe(true);
  });

  it("lets a retained instruction continue an open session", () => {
    const waiting = (session: unknown): AgentPlanRun =>
      run({ steps: [step({ status: "succeeded", session })] });
    const instruction = binding({ isInstruction: true });
    expect(() =>
      requirePlanDispatchFence(
        waiting({ endedAt: null, sessionId: "s" }),
        instruction,
      ),
    ).not.toThrow();
    expect(
      isStale(waiting({ endedAt: null, sessionId: "" }), instruction),
    ).toBe(true);
    expect(
      isStale(waiting({ endedAt: "t", sessionId: "s" }), instruction),
    ).toBe(true);
    expect(isStale(waiting(undefined), instruction)).toBe(true);
    expect(isStale(waiting({ endedAt: null, sessionId: "s" }), binding())).toBe(
      true,
    );
  });

  it("resolves a managed owner step, also inside a loop iteration", () => {
    const managed = binding({ managed: true });
    expect(() => requirePlanDispatchFence(run(), managed)).not.toThrow();
    const owner = step({ id: "owner" });
    const looped = run({
      steps: [],
      loops: [{ iterations: [{ nodes: [owner] }] }],
    });
    expect(() =>
      requirePlanDispatchFence(
        looped,
        binding({ managed: true, ownerStepId: "owner" }),
      ),
    ).not.toThrow();
    expect(
      isStale(looped, binding({ managed: true, ownerStepId: "none" })),
    ).toBe(true);
    expect(isStale(run({ id: "other" }), managed)).toBe(true);
  });
});
