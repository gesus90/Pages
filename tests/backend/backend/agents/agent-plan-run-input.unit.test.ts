import { expect, it } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";

import { agentErrorCode } from "./agent-error-code";
import { stepResult } from "./agent-plan-record-fixture";

import type { RecordFields } from "./agent-plan-record-fixture";

function run(changes: RecordFields = {}): RecordFields {
  return {
    id: "run",
    planId: "plan",
    planName: "Plan",
    userId: "owner",
    startedAt: "start",
    planRevision: 1,
    status: "running",
    stopRequested: false,
    steps: [stepResult()],
    ...changes,
  };
}

it("reads a run without optional parts", () => {
  expect(readPlanRun(run({ controlError: "other" }))).toEqual({
    id: "run",
    planId: "plan",
    planName: "Plan",
    userId: "owner",
    startedAt: "start",
    planRevision: 1,
    status: "running",
    stopRequested: false,
    steps: [expect.objectContaining({ id: "s1" })],
  });
});

it("reads the optional parts of a run", () => {
  const stored = run({
    status: "paused",
    isWaitingForWorkspace: true,
    workspaceWait: {
      resource: "local-directory:/owned",
      reason: "writer_reserved",
      runId: "other",
      jobId: null,
      attemptId: null,
    },
    endedAt: "end",
    controlError: "plan_step_failed",
    pauseBoundary: {
      pausedAt: "p",
      completedStepIds: [],
      pendingStepIds: [],
      frontierStepIds: [],
    },
    continuation: { version: 1, planRevision: 1, adoptedAt: "a" },
    recovery: { state: "recoverable", requiresReconciliation: false },
    origin: {
      kind: "restart",
      runId: "old",
      mode: null,
      checkpointVersion: null,
      reusedStepIds: [],
      retriedStepIds: [],
      reviewedStepIds: [],
      requestedAt: "now",
    },
    loops: [],
  });
  const parsed = readPlanRun(stored);
  expect(parsed).toMatchObject({
    endedAt: "end",
    controlError: "plan_step_failed",
    pauseBoundary: { pausedAt: "p" },
    continuation: { version: 1 },
    recovery: { state: "recoverable" },
    origin: { kind: "restart" },
    loops: [],
  });
  expect(parsed.isWaitingForWorkspace).toBeUndefined();
  expect(parsed.workspaceWait).toBeUndefined();
  const waiting = readPlanRun({ ...stored, status: "running" });
  expect(waiting.isWaitingForWorkspace).toBe(true);
  expect(waiting.workspaceWait).toEqual(stored.workspaceWait);
  const stopped = readPlanRun({
    ...stored,
    status: "running",
    stopRequested: true,
  });
  expect(stopped.isWaitingForWorkspace).toBeUndefined();
  expect(stopped.workspaceWait).toBeUndefined();
});

it.each<[string, RecordFields]>([
  ["an unknown status", { status: "done" }],
  ["a status that is no text", { status: 1 }],
  ["a revision that is no number", { planRevision: "1" }],
  ["a fractional revision", { planRevision: 1.5 }],
  ["a revision below one", { planRevision: 0 }],
  ["a stop flag that is no boolean", { stopRequested: "no" }],
  ["steps that are no list", { steps: {} }],
  [
    "more than 100 steps",
    { steps: Array.from({ length: 101 }, () => stepResult()) },
  ],
])("refuses a run with %s", (scenario, change) => {
  expect(agentErrorCode(() => readPlanRun(run(change)))).toBe("plan_invalid");
});
