import { AgentError } from "@/backend/error/AgentErrors";

import { readPlanText } from "./AgentPlanInput";
import { readAgentObject } from "./AgentPayload";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

function readResult(input: unknown): AgentPlanStepResult {
  const step = readAgentObject(input);
  const { status, cancellation, output, error } = step;
  if (
    status !== "waiting" &&
    status !== "running" &&
    status !== "succeeded" &&
    status !== "failed" &&
    status !== "cancelled"
  )
    throw new AgentError("plan_invalid");
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
    name: readPlanText(step.name, 120),
    status,
    cancellation,
    isBlocked: step.isBlocked,
    output,
    error,
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
    status !== "cancelled"
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
