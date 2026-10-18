import { AgentError } from "@/backend/error/AgentErrors";

import { readAgentObject } from "./AgentPayload";
import { readPlanText } from "./AgentPlanInput";

import type { AgentPlanRun } from "@/definition/AgentPlan";

function identifiers(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length > 100)
    throw new AgentError("plan_invalid");
  return input.map((entry: unknown) => readPlanText(entry));
}

/** Old records have no pause boundary; they never acquire an invented continuation. */
export function readPlanPauseBoundary(
  input: unknown,
): Pick<AgentPlanRun, "pauseBoundary"> {
  if (input === undefined) return {};
  const boundary = readAgentObject(input);
  return {
    pauseBoundary: {
      pausedAt: readPlanText(boundary.pausedAt),
      completedStepIds: identifiers(boundary.completedStepIds),
      pendingStepIds: identifiers(boundary.pendingStepIds),
      frontierStepIds: identifiers(boundary.frontierStepIds),
    },
  };
}

/** Reads only the public revision marker, never a private execution snapshot. */
export function readPlanContinuation(
  input: unknown,
): Pick<AgentPlanRun, "continuation"> {
  if (input === undefined) return {};
  const entry = readAgentObject(input);
  const { version, planRevision } = entry;
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof planRevision !== "number" ||
    !Number.isSafeInteger(planRevision) ||
    planRevision < 1
  )
    throw new AgentError("plan_invalid");
  return {
    continuation: {
      version,
      planRevision,
      adoptedAt: readPlanText(entry.adoptedAt),
    },
  };
}
