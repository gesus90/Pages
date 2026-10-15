import { AgentError } from "@/backend/error/AgentErrors";

import { readPlanText } from "./AgentPlanInput";
import { readPlanSessionRecord } from "./AgentPlanSessionInput";
import { readAgentObject } from "./AgentPayload";

import type {
  AgentPlanRun,
  AgentPlanStepResult,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";

function readResult(input: unknown): AgentPlanStepResult {
  const step = readAgentObject(input);
  const { status, cancellation, output, error } = step;
  if (!isStepStatus(status)) throw new AgentError("plan_invalid");
  if (
    cancellation !== "none" &&
    cancellation !== "requested" &&
    cancellation !== "confirmed" &&
    cancellation !== "not_started"
  )
    throw new AgentError("plan_invalid");
  if (
    typeof step.isBlocked !== "boolean" ||
    (output !== null && typeof output !== "string") ||
    (error !== null && typeof error !== "string")
  )
    throw new AgentError("plan_invalid");
  return {
    id: readPlanText(step.id),
    ...(step.groupId === undefined
      ? {}
      : { groupId: readPlanText(step.groupId) }),
    ...(step.failedStepId === undefined
      ? {}
      : { failedStepId: readPlanText(step.failedStepId) }),
    name: readPlanText(step.name, 120),
    status,
    cancellation,
    isBlocked: step.isBlocked,
    output,
    error,
    session: readPlanSessionRecord(step.session),
  };
}

/** Narrows a persisted public view; private snapshots are never deserialized into route responses. */
export function readPlanRun(input: unknown): AgentPlanRun {
  const run = readAgentObject(input);
  const { status, planRevision, stopRequested } = run;
  if (
    status !== "running" &&
    status !== "succeeded" &&
    status !== "failed" &&
    status !== "cancelled" &&
    status !== "paused"
  )
    throw new AgentError("plan_invalid");
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
    planRevision,
    status,
    stopRequested,
    steps: run.steps.map(readResult),
  };
}

function isStepStatus(input: unknown): input is AgentPlanStepStatus {
  return (
    typeof input === "string" &&
    [
      "waiting",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "paused",
    ].includes(input)
  );
}
