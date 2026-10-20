import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";

import type { PlanSessionClosed } from "@/backend/agents/AgentPlanExecution";
import type {
  AgentPlanSessionRecord,
  AgentPlanAcceptance,
} from "@/definition/AgentPlanSession";
import type { AgentPlanStepSnapshot } from "./AgentPlanSnapshot";

interface PlanFailureNode {
  readonly hasStarted: boolean;
  readonly record: AgentPlanSessionRecord | null;
  readonly step: AgentPlanStepSnapshot;
  /** Set for a member of a loop; its session may outlive the node. */
  readonly loop?: unknown;
}
/** Converts only safe provider and application codes. */
export function errorCode(error: unknown): string {
  if (error instanceof AgentError || error instanceof AgentExecutionError)
    return error.code;
  return "plan_step_failed";
}

/**
 * The closeout of a failed loop member from the session that was closed with it.
 *
 * @returns `null` outside loops and where nothing is known. A turn that only
 * continued a shared session started no process; once that session is gone
 * its own closeout is `not_needed`, the session's closeout lives in the
 * record that opened it.
 */
function loopFailureCloseout(
  node: PlanFailureNode,
  closed: PlanSessionClosed | undefined,
): AgentPlanSessionRecord["closeout"] | null {
  if (!node.loop) return null;
  if (closed) return closed.isConfirmed ? "confirmed" : "failed";
  return node.record?.loop?.role === "continued" ? "not_needed" : null;
}

/** A started session without confirmation keeps its reservation. */
export function failureCloseout(
  node: PlanFailureNode,
  error: unknown,
  closed?: PlanSessionClosed,
): AgentPlanSessionRecord["closeout"] {
  const loopCloseout = loopFailureCloseout(node, closed);
  if (loopCloseout !== null) return loopCloseout;
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
