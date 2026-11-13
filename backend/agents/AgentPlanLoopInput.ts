import { AgentError } from "@/backend/error/AgentErrors";
import {
  PLAN_LOOP_VALUE_LENGTH,
  parsePlanLoopPath,
} from "@/definition/AgentPlanLoop";

import { readAgentObject } from "./AgentPayload";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type {
  AgentPlanLoopCondition,
  AgentPlanLoopValue,
  AgentPlanLoopWhile,
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

/**
 * Narrows the later checks of a while loop.
 *
 * @param input - The stored or submitted setting, or `null` for none.
 * @throws {AgentError} `plan_loop_invalid` for an unknown field, a too long
 * member id or an unsupported path. An empty member reads the bound boolean again.
 */
export function readPlanLoopWhile(input: unknown): AgentPlanLoopWhile | null {
  if (input === null) return null;
  const setting = readAgentObject(input);
  const { sourceNodeId, outputPath } = setting;
  if (
    Object.keys(setting).some(
      (key) => key !== "sourceNodeId" && key !== "outputPath",
    ) ||
    typeof sourceNodeId !== "string" ||
    sourceNodeId.length > 100 ||
    typeof outputPath !== "string" ||
    (outputPath !== "" && parsePlanLoopPath(outputPath) === null)
  )
    throw invalid();
  return { sourceNodeId, outputPath };
}

/** How many nodes a group or loop holds, the agents of a loop's groups included. */
export function containedCount(node: AgentPlanNode): number {
  if (node.type === "group") return node.steps.length;
  if (node.type !== "loop") return 0;
  return node.steps.reduce(
    (count, step) =>
      count + 1 + (step.type === "group" ? step.steps.length : 0),
    0,
  );
}
