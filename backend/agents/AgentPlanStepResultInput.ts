import {
  planStepExecutionSchema,
  planRemoteProgressSchema,
} from "@/definition/AgentPlanExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import { planScriptAssessmentSchema } from "@/definition/AgentPlanScriptReport";
import {
  assetFailureSchema,
  planRemoteAccessSchema,
} from "@/definition/AgentPlanRemoteAccess";

import { readPlanProgress } from "./AgentPlanProgressInput";
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
  if (typeof step.isBlocked !== "boolean") throw new AgentError("plan_invalid");
  const display = readStepDisplay(step.isDisplayFiltered);
  if (
    (output !== null && typeof output !== "string") ||
    (error !== null && typeof error !== "string")
  )
    throw new AgentError("plan_invalid");
  return {
    id: readPlanText(step.id),

    ...readExecutionMetadata(step),

    ...readStepReferences(step),
    name: readPlanText(step.name, 120),
    status,
    cancellation,
    isBlocked: step.isBlocked,
    output,
    error,
    ...display,
    session: readPlanSessionRecord(step.session),
    ...readStepArtifacts(step),
  };
}

function readStepDisplay(
  filtered: unknown,
): Pick<AgentPlanStepResult, "isDisplayFiltered"> {
  if (filtered !== undefined && typeof filtered !== "boolean")
    throw new AgentError("plan_invalid");
  return filtered === undefined ? {} : { isDisplayFiltered: filtered };
}

function readStepArtifacts(
  step: Record<string, unknown>,
): Pick<AgentPlanStepResult, "script" | "report" | "progress"> {
  return {
    ...(step.script === undefined
      ? {}
      : { script: readPlanScriptRun(step.script) }),
    ...(step.report === undefined
      ? {}
      : { report: readScriptReport(step.report) }),
    ...(step.progress === undefined
      ? {}
      : { progress: readPlanProgress(step.progress) }),
  };
}

function readScriptReport(
  input: unknown,
): ReturnType<typeof planScriptAssessmentSchema.parse> {
  const parsed = planScriptAssessmentSchema.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
}

/** Reads optional references without assigning a cause to historical records. */
function readStepReferences(
  step: Record<string, unknown>,
): Pick<AgentPlanStepResult, "groupId" | "failedStepId" | "blockedByStepId"> {
  return {
    ...(step.groupId === undefined
      ? {}
      : { groupId: readPlanText(step.groupId) }),
    ...(step.failedStepId === undefined
      ? {}
      : { failedStepId: readPlanText(step.failedStepId) }),
    ...(step.blockedByStepId === undefined
      ? {}
      : { blockedByStepId: readPlanText(step.blockedByStepId) }),
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

function readExecutionMetadata(
  step: Record<string, unknown>,
): Pick<
  AgentPlanStepResult,
  "execution" | "remote" | "resourceAccess" | "assetFailure"
> {
  return {
    ...(step.assetFailure === undefined
      ? {}
      : { assetFailure: assetFailureSchema.parse(step.assetFailure) }),
    ...(step.resourceAccess === undefined
      ? {}
      : { resourceAccess: planRemoteAccessSchema.parse(step.resourceAccess) }),
    ...(step.remote === undefined
      ? {}
      : { remote: planRemoteProgressSchema.parse(step.remote) }),
    ...(step.execution === undefined
      ? {}
      : { execution: planStepExecutionSchema.parse(step.execution) }),
  };
}
