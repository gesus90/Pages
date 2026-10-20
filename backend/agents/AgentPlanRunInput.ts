import { AgentError } from "@/backend/error/AgentErrors";

import {
  readPlanContinuation,
  readPlanPauseBoundary,
} from "./AgentPlanContinuationInput";
import { readPlanText } from "./AgentPlanInput";
import { readPlanLoopRuns } from "./AgentPlanLoopRunInput";
import { readPlanStepResult } from "./AgentPlanStepResultInput";
import { readAgentObject } from "./AgentPayload";
import { readPlanRecoveryReason } from "./AgentPlanRecoveryInput";

import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Narrows a persisted public view; private snapshots are never deserialized into route responses. */
export function readPlanRun(input: unknown): AgentPlanRun {
  const run = readAgentObject(input);
  const { status, planRevision, stopRequested } = run;
  if (!isRunStatus(status)) throw new AgentError("plan_invalid");
  if (
    typeof planRevision !== "number" ||
    !Number.isSafeInteger(planRevision) ||
    planRevision < 1 ||
    typeof stopRequested !== "boolean" ||
    !Array.isArray(run.steps) ||
    run.steps.length > 100
  )
    throw new AgentError("plan_invalid");
  return {
    id: readPlanText(run.id),
    planId: readPlanText(run.planId),
    planName: readPlanText(run.planName, 120),
    userId: readPlanText(run.userId),
    startedAt: readPlanText(run.startedAt),
    ...(run.endedAt === undefined
      ? {}
      : { endedAt: readPlanText(run.endedAt) }),
    planRevision,
    status,
    stopRequested,
    ...(run.controlError === "plan_step_failed"
      ? { controlError: run.controlError }
      : {}),
    ...readPlanPauseBoundary(run.pauseBoundary),
    ...readPlanContinuation(run.continuation),
    ...(run.recovery === undefined
      ? {}
      : { recovery: readPlanRecoveryReason(run.recovery) }),
    steps: run.steps.map(readPlanStepResult),
    ...(run.loops === undefined ? {} : { loops: readPlanLoopRuns(run.loops) }),
  };
}

function isRunStatus(input: unknown): input is AgentPlanRun["status"] {
  return (
    typeof input === "string" &&
    [
      "running",
      "pausing",
      "stopping",
      "succeeded",
      "failed",
      "cancelled",
      "paused",
    ].includes(input)
  );
}
