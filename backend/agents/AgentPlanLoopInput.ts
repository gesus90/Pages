import { AgentError } from "@/backend/error/AgentErrors";
import {
  PLAN_LOOP_VALUE_LENGTH,
  parsePlanLoopPath,
} from "@/definition/AgentPlanLoop";

import { readAgentObject } from "./AgentPayload";

import type {
  AgentPlanLoopCondition,
  AgentPlanLoopValue,
} from "@/definition/AgentPlanLoop";

function invalid(): AgentError {
  return new AgentError("plan_loop_invalid");
}

/** Narrows a typed expected value of an end condition; the type decides the comparison. */
export function readPlanLoopValue(input: unknown): AgentPlanLoopValue {
  const entry = readAgentObject(input);
  if (entry.type === "null") return { type: "null" };
  if (entry.type === "boolean" && typeof entry.value === "boolean")
    return { type: "boolean", value: entry.value };
  if (
    entry.type === "number" &&
    typeof entry.value === "number" &&
    Number.isFinite(entry.value)
  )
    return { type: "number", value: entry.value };
  if (
    entry.type === "string" &&
    typeof entry.value === "string" &&
    entry.value.length <= PLAN_LOOP_VALUE_LENGTH
  )
    return { type: "string", value: entry.value };
  throw invalid();
}

/**
 * Narrows the saved end condition of a loop.
 *
 * @param input - The stored or submitted condition, or `null` for none.
 * @throws {AgentError} `plan_loop_invalid` for an unsupported operator, an
 * unsupported path or a malformed value, also while the condition is off.
 */
export function readPlanLoopCondition(
  input: unknown,
): AgentPlanLoopCondition | null {
  if (input === null || input === undefined) return null;
  const condition = readAgentObject(input);
  const { isEnabled, sourceNodeId, outputPath } = condition;
  if (
    typeof isEnabled !== "boolean" ||
    typeof sourceNodeId !== "string" ||
    sourceNodeId.length > 100 ||
    condition.operator !== "equals" ||
    typeof outputPath !== "string" ||
    (outputPath !== "" && parsePlanLoopPath(outputPath) === null)
  )
    throw invalid();
  return {
    isEnabled,
    sourceNodeId,
    outputPath,
    operator: "equals",
    expected: readPlanLoopValue(condition.expected),
  };
}
