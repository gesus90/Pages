import { planSwarmRunSchema } from "@/definition/AgentPlanSwarmRun";
import {
  planJumpRunSchema,
  planSignalRunSchema,
} from "@/definition/AgentPlanJump";
import {
  planStepExecutionSchema,
  planRemoteProgressSchema,
} from "@/definition/AgentPlanExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import { planScriptAssessmentSchema } from "@/definition/AgentPlanScriptReport";
import { planRunBranchSchema } from "@/definition/AgentPlanRunBranch";
import {
  assetFailureSchema,
  planRemoteAccessSchema,
} from "@/definition/AgentPlanRemoteAccess";

import { readPlanActivationFields } from "./AgentPlanActivationInput";
import { readAgentTodoList } from "./AgentPlanAgentTodoInput";
import { readPlanProgress } from "./AgentPlanProgressInput";
import { readPlanFailureStop } from "./AgentPlanRetryInput";
import { readPlanText } from "./AgentPlanInput";
import { readPlanSessionRecord } from "./AgentPlanSessionInput";
import { readAgentObject } from "./AgentPayload";
import { readPlanScriptRun } from "./AgentPlanScriptRunInput";
import { readPlanStackHandover } from "./AgentPlanStackRunInput";
import { readAgentParameterValue } from "./AgentConfigurationInput";

import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanRunBranch } from "@/definition/AgentPlanRunBranch";
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
  const skipped = readStepSkipped(step.skipped);
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
    ...skipped,
    session: readPlanSessionRecord(step.session),
    ...readStepArtifacts(step),
    ...readPlanActivationFields(step),
    ...(step.failureStop === undefined
      ? {}
      : { failureStop: readPlanFailureStop(step.failureStop) }),
    ...(step.stack === undefined
      ? {}
      : { stack: readPlanStackHandover(step.stack) }),
    ...readStepSwarm(step.swarm),
    ...readStepJump(step),
  };
}

function readNamedValues(
  input: unknown,
): Readonly<Record<string, AgentParameterValue>> {
  const entries = Object.entries(readAgentObject(input));
  if (entries.length > 64) throw new AgentError("plan_invalid");
  return Object.fromEntries(
    entries.map(([name, value]) => [
      readPlanText(name, 130),
      readAgentParameterValue(value),
    ]),
  );
}

/** Reads the call of an outgoing Jump, the values it handed on and the returns of an end. */
function readStepJump(
  step: Record<string, unknown>,
): Pick<AgentPlanStepResult, "jump" | "jumpOutputs" | "returned" | "signal"> {
  const jump =
    step.jump === undefined
      ? undefined
      : planJumpRunSchema.safeParse(step.jump);
  const signal =
    step.signal === undefined
      ? undefined
      : planSignalRunSchema.safeParse(step.signal);
  if ((jump && !jump.success) || (signal && !signal.success))
    throw new AgentError("plan_invalid");
  return {
    ...(jump?.success ? { jump: jump.data } : {}),
    ...(signal?.success ? { signal: signal.data } : {}),
    ...(step.jumpOutputs === undefined
      ? {}
      : { jumpOutputs: readNamedValues(step.jumpOutputs) }),
    ...(step.returned === undefined
      ? {}
      : { returned: readNamedValues(step.returned) }),
  };
}

/** Reads the lanes and board of a swarm node; a damaged view is refused like any damaged result. */
function readStepSwarm(swarm: unknown): Pick<AgentPlanStepResult, "swarm"> {
  if (swarm === undefined) return {};
  const parsed = planSwarmRunSchema.safeParse(swarm);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return { swarm: parsed.data };
}

function readStepSkipped(
  skipped: unknown,
): Pick<AgentPlanStepResult, "skipped"> {
  if (skipped !== undefined && typeof skipped !== "boolean")
    throw new AgentError("plan_invalid");
  return skipped === true ? { skipped: true } : {};
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
): Pick<
  AgentPlanStepResult,
  "script" | "report" | "progress" | "agentTodos" | "runBranch"
> {
  return {
    ...(step.script === undefined
      ? {}
      : { script: readPlanScriptRun(step.script) }),
    ...(step.runBranch === undefined
      ? {}
      : { runBranch: readRunBranch(step.runBranch) }),
    ...(step.report === undefined
      ? {}
      : { report: readScriptReport(step.report) }),
    ...(step.progress === undefined
      ? {}
      : { progress: readPlanProgress(step.progress) }),
    ...(step.agentTodos === undefined
      ? {}
      : { agentTodos: readAgentTodoList(step.agentTodos) }),
  };
}

function readRunBranch(input: unknown): AgentPlanRunBranch {
  const parsed = planRunBranchSchema.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
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
): Pick<
  AgentPlanStepResult,
  "groupId" | "role" | "failedStepId" | "blockedByStepId"
> {
  if (step.role !== undefined && step.role !== "closeout")
    throw new AgentError("plan_invalid");
  return {
    ...(step.role === undefined ? {} : { role: step.role }),
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
      "skipped",
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
