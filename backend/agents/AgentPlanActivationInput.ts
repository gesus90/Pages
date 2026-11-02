import { PLAN_ACTIVATION_LIMIT } from "@/definition/AgentPlanBranching";
import { AgentError } from "@/backend/error/AgentErrors";

import { readAgentObject } from "./AgentPayload";
import { readPlanText } from "./AgentPlanInput";

import type {
  AgentPlanActivationSource,
  AgentPlanActivationTrigger,
  AgentPlanDecisionInput,
  AgentPlanStepActivation,
  AgentPlanStepResult,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";
import type { AgentPlanBranch } from "@/definition/AgentPlanBranching";

const STATUSES: readonly AgentPlanStepStatus[] = [
  "waiting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "paused",
  "skipped",
];

function invalid(): AgentError {
  return new AgentError("plan_invalid");
}

function readCount(input: unknown): number {
  if (
    typeof input !== "number" ||
    !Number.isSafeInteger(input) ||
    input < 1 ||
    input > PLAN_ACTIVATION_LIMIT
  )
    throw invalid();
  return input;
}

function readBranch(input: unknown): AgentPlanBranch {
  if (input !== "true" && input !== "false") throw invalid();
  return input;
}

function readNullableText(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== "string") throw invalid();
  return input;
}

function readSource(input: unknown): AgentPlanActivationSource {
  const source = readAgentObject(input);
  return {
    stepId: readPlanText(source.stepId),
    activation: readCount(source.activation),
  };
}

function readTrigger(input: unknown): AgentPlanActivationTrigger {
  const trigger = readAgentObject(input);
  const length = trigger.promptLength;
  if (
    trigger.kind !== "event" ||
    !Array.isArray(trigger.sources) ||
    trigger.sources.length === 0 ||
    trigger.sources.length > 100 ||
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  )
    throw invalid();
  const sources: readonly unknown[] = trigger.sources;
  return {
    kind: "event",
    sources: sources.map(readSource),
    promptLength: length,
  };
}

function readCondition(input: unknown): AgentPlanDecisionInput {
  const condition = readAgentObject(input);
  if (typeof condition.value !== "boolean") throw invalid();
  return {
    sourceStepId: readPlanText(condition.sourceStepId),
    sourceActivation: readCount(condition.sourceActivation),
    value: condition.value,
  };
}

function readStatus(input: unknown): AgentPlanStepStatus {
  const status = STATUSES.find((entry) => entry === input);
  if (status === undefined) throw invalid();
  return status;
}

/** Reads the facts every start of a node shares: result, passed state, branch, condition and trigger. */
function readStartFacts(
  entry: Record<string, unknown>,
): Pick<
  AgentPlanStepActivation,
  "passed" | "branch" | "condition" | "trigger"
> {
  if (entry.passed !== undefined && typeof entry.passed !== "boolean")
    throw invalid();
  return {
    ...(entry.passed === undefined ? {} : { passed: entry.passed }),
    ...(entry.branch === undefined ? {} : { branch: readBranch(entry.branch) }),
    ...(entry.condition === undefined
      ? {}
      : { condition: readCondition(entry.condition) }),
    ...(entry.trigger === undefined
      ? {}
      : { trigger: readTrigger(entry.trigger) }),
  };
}

function readHistoryEntry(input: unknown): AgentPlanStepActivation {
  const entry = readAgentObject(input);
  return {
    activation: readCount(entry.activation),
    status: readStatus(entry.status),
    output: readNullableText(entry.output),
    error: readNullableText(entry.error),
    startedAt: readNullableText(entry.startedAt ?? null),
    endedAt: readNullableText(entry.endedAt ?? null),
    ...readStartFacts(entry),
  };
}

/**
 * Reads what a node that ran more than once adds to its result.
 *
 * @param step - The stored result of the node.
 * @returns The activation count, the passed state, the branch, the condition,
 * the trigger and the earlier starts; each only when stored.
 */
export function readPlanActivationFields(
  step: Record<string, unknown>,
): Pick<
  AgentPlanStepResult,
  "activation" | "passed" | "branch" | "condition" | "trigger" | "history"
> {
  if (step.history !== undefined && !Array.isArray(step.history))
    throw invalid();
  const history: readonly unknown[] = step.history ?? [];
  if (history.length > PLAN_ACTIVATION_LIMIT) throw invalid();
  return {
    ...(step.activation === undefined
      ? {}
      : { activation: readCount(step.activation) }),
    ...readStartFacts(step),
    ...(step.history === undefined
      ? {}
      : { history: history.map(readHistoryEntry) }),
  };
}
