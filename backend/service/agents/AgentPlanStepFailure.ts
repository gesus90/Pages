import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";

import type {
  AgentPlanSessionRecord,
  AgentPlanAcceptance,
} from "@/definition/AgentPlanSession";
import type { AgentPlanStepSnapshot } from "./AgentPlanSnapshot";

interface PlanFailureNode {
  readonly hasStarted: boolean;
  readonly record: AgentPlanSessionRecord | null;
  readonly step: AgentPlanStepSnapshot;
}
/** Converts only safe provider and application codes. */
export function errorCode(error: unknown): string {
  if (error instanceof AgentError || error instanceof AgentExecutionError)
    return error.code;
  return "plan_step_failed";
}

/** A started session without confirmation keeps its reservation. */
export function failureCloseout(
  node: PlanFailureNode,
  error: unknown,
): AgentPlanSessionRecord["closeout"] {
  if (
    error instanceof AcpCleanupUnconfirmedError ||
    (node.hasStarted && node.record?.closeout === "pending")
  )
    return "failed";
  const closeout = node.record?.closeout ?? "not_needed";
  return closeout === "pending" ? "not_needed" : closeout;
}

/** Group and OpenCode success also needs business acceptance. */
export function planAcceptanceFailure(
  node: PlanFailureNode,
  acceptance: AgentPlanAcceptance | null,
): "plan_group_acceptance_failed" | "opencode_acceptance_failed" | null {
  if (acceptance?.verdict === "accepted") return null;
  if (node.step.groupId) return "plan_group_acceptance_failed";
  return node.step.provider === "opencode"
    ? "opencode_acceptance_failed"
    : null;
}

/** Identifies adapters with mandatory acceptance. */
export function requiresAcceptance(step: AgentPlanStepSnapshot): boolean {
  return Boolean(step.groupId) || step.provider === "opencode";
}
