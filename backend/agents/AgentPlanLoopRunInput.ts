import { AgentError } from "@/backend/error/AgentErrors";
import { isPlanLoopRuns } from "@/definition/AgentPlanLoop";

import { readAgentObject } from "./AgentPayload";
import { readPlanText } from "./AgentPlanInput";
import { readPlanLoopValue } from "./AgentPlanLoopInput";
import { isStepStatus, readPlanStepResult } from "./AgentPlanStepResultInput";

import type {
  AgentPlanLoopConditionFailure,
  AgentPlanLoopConditionOutcome,
  AgentPlanLoopCount,
  AgentPlanLoopFound,
  AgentPlanLoopIteration,
  AgentPlanLoopRun,
  AgentPlanLoopSession,
} from "@/definition/AgentPlanLoopRun";

const FAILURES: readonly AgentPlanLoopConditionFailure[] = [
  "plan_loop_condition_source",
  "plan_loop_condition_path",
  "plan_loop_output_missing",
  "plan_loop_output_invalid",
  "plan_loop_output_ambiguous",
  "plan_loop_condition_field",
  "plan_loop_condition_type",
];
const CLEANUPS = ["not_needed", "pending", "confirmed", "failed"] as const;
const SESSION_STATES = ["open", "closed", "lost", "not_retained"] as const;

function invalid(): AgentError {
  return new AgentError("plan_invalid");
}

function oneOf<Value extends string>(
  input: unknown,
  values: readonly Value[],
): Value {
  const match = values.find((value) => value === input);
  if (match === undefined) throw invalid();
  return match;
}

function nullableText(input: unknown, maximum = 1_000): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") throw invalid();
  return input.slice(0, maximum);
}

function readFound(input: unknown): AgentPlanLoopFound {
  const found = readAgentObject(input);
  if (found.type === "object" || found.type === "array")
    return { type: found.type };
  return readPlanLoopValue(found);
}

function readOutcome(input: unknown): AgentPlanLoopConditionOutcome {
  const outcome = readAgentObject(input);
  if (outcome.state === "not_evaluated")
    return {
      state: "not_evaluated",
      reason: oneOf(outcome.reason, [
        "disabled",
        "expected",
        "incomplete",
      ] as const),
    };
  if (outcome.state === "failed")
    return { state: "failed", code: oneOf(outcome.code, FAILURES) };
  if (outcome.state !== "evaluated" || typeof outcome.isMet !== "boolean")
    throw invalid();
  return {
    state: "evaluated",
    isMet: outcome.isMet,
    found: readFound(outcome.found),
  };
}

function readIteration(input: unknown): AgentPlanLoopIteration {
  const iteration = readAgentObject(input);
  if (
    typeof iteration.number !== "number" ||
    !Number.isSafeInteger(iteration.number) ||
    iteration.number < 1 ||
    !isStepStatus(iteration.status) ||
    !Array.isArray(iteration.nodes) ||
    iteration.nodes.length > 100
  )
    throw invalid();
  return {
    id: readPlanText(iteration.id),
    number: iteration.number,
    status: iteration.status,
    startedAt: readPlanText(iteration.startedAt),
    endedAt: nullableText(iteration.endedAt),
    nodes: iteration.nodes.map(readPlanStepResult),
    condition: readOutcome(iteration.condition),
    error: nullableText(iteration.error),
  };
}

function readSession(input: unknown): AgentPlanLoopSession {
  const session = readAgentObject(input);
  if (
    typeof session.turns !== "number" ||
    !Number.isSafeInteger(session.turns) ||
    session.turns < 0 ||
    (session.createdInIteration !== null &&
      session.createdInIteration !== undefined &&
      (typeof session.createdInIteration !== "number" ||
        !Number.isSafeInteger(session.createdInIteration)))
  )
    throw invalid();
  return {
    nodeId: readPlanText(session.nodeId),
    key: readPlanText(session.key, 300),
    policy: oneOf(session.policy, ["reuse", "fresh"] as const),
    state: oneOf(session.state, SESSION_STATES),
    createdInIteration:
      typeof session.createdInIteration === "number"
        ? session.createdInIteration
        : null,
    turns: session.turns,
    instanceId: nullableText(session.instanceId, 100),
    acpSessionId: nullableText(session.acpSessionId, 200),
    nativeSessionId: nullableText(session.nativeSessionId, 200),
    closeout: oneOf(session.closeout, CLEANUPS),
  };
}

function readCount(input: unknown): AgentPlanLoopCount | null {
  if (input === null || input === undefined) return null;
  const count = readAgentObject(input);
  if (!isPlanLoopRuns(count.effective)) throw invalid();
  return {
    source: oneOf(count.source, ["value", "parameter"] as const),
    parameterId: nullableText(count.parameterId, 100),
    effective: count.effective,
    mode: oneOf(count.mode, ["max", "expected"] as const),
  };
}

function readCondition(input: unknown): AgentPlanLoopRun["condition"] {
  if (input === null || input === undefined) return null;
  const condition = readAgentObject(input);
  if (typeof condition.isActive !== "boolean") throw invalid();
  return {
    isActive: condition.isActive,
    sourceNodeId: readPlanText(condition.sourceNodeId),
    outputPath: readPlanText(condition.outputPath, 200),
    expected: readPlanLoopValue(condition.expected),
  };
}

function readLoopRun(input: unknown): AgentPlanLoopRun {
  const loop = readAgentObject(input);
  if (
    !isStepStatus(loop.status) ||
    !Array.isArray(loop.iterations) ||
    loop.iterations.length > 999 ||
    !Array.isArray(loop.sessions) ||
    loop.sessions.length > 100
  )
    throw invalid();
  return {
    id: readPlanText(loop.id),
    name: readPlanText(loop.name, 120),
    status: loop.status,
    count: readCount(loop.count),
    sessionPolicy: oneOf(loop.sessionPolicy, ["reuse", "fresh"] as const),
    condition: readCondition(loop.condition),
    iterations: loop.iterations.map(readIteration),
    sessions: loop.sessions.map(readSession),
    completion:
      loop.completion === null || loop.completion === undefined
        ? null
        : oneOf(loop.completion, ["count_reached", "condition_met"] as const),
    cleanup: oneOf(loop.cleanup, CLEANUPS),
    startedAt: nullableText(loop.startedAt, 100),
    endedAt: nullableText(loop.endedAt, 100),
    error: nullableText(loop.error, 200),
  };
}

/** Narrows the persisted loop states of a run; a malformed one makes the record unreadable. */
export function readPlanLoopRuns(input: unknown): readonly AgentPlanLoopRun[] {
  if (!Array.isArray(input) || input.length > 100) throw invalid();
  return input.map(readLoopRun);
}
