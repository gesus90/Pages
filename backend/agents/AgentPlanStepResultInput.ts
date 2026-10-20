import { readPlanProgress } from "./AgentPlanProgressInput";
import { AgentError } from "@/backend/error/AgentErrors";

import { readPlanText } from "./AgentPlanInput";
import { readPlanSessionRecord } from "./AgentPlanSessionInput";
import { readAgentObject } from "./AgentPayload";
import { readPlanScriptRun } from "./AgentPlanScriptRunInput";

import type {
  AgentPlanStepResult,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";

/** Narrows one persisted node result of a run or of a loop iteration. */
export function readPlanStepResult(input: unknown): AgentPlanStepResult {
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
    ...(step.script === undefined
      ? {}
      : { script: readPlanScriptRun(step.script) }),
    ...(step.progress === undefined
      ? {}
      : { progress: readPlanProgress(step.progress) }),
  };
}

/** Narrows a persisted status of a node. */
export function isStepStatus(input: unknown): input is AgentPlanStepStatus {
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
