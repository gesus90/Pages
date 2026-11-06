import { AgentAssetReferenceError } from "@/backend/error/AgentAssetReferenceError";
import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import { explicitPlanBlocker } from "./AgentPlanAcceptance";
import { hasPlanStepTimedOut } from "./AgentPlanSessionRecords";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { PlanSessionClosed } from "@/backend/agents/AgentPlanExecution";
import type {
  AgentPlanSessionRecord,
  AgentPlanAcceptance,
} from "@/definition/AgentPlanSession";
import type { AgentPlanStepSnapshot } from "./AgentPlanSnapshot";
import type { NodeRun } from "./AgentPlanStepContext";

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

/** Every agent needs business acceptance independently of its technical exit. */
export function planAcceptanceFailure(
  node: PlanFailureNode,
  acceptance: AgentPlanAcceptance | null,
): "plan_group_acceptance_failed" | "plan_acceptance_failed" | null {
  if (acceptance?.verdict === "accepted") return null;
  if (node.step.groupId) return "plan_group_acceptance_failed";
  return "plan_acceptance_failed";
}

/**
 * What a valid report that shows unmet work is called: not passed.
 *
 * @remarks
 * A report that is missing, unreadable, unproven or contradicted by the
 * tickets stays a failed acceptance, never a `false`: a boolean result needs
 * a trustworthy report, otherwise it would hide a configuration error.
 */
const UNMET_WORK_ISSUE = /^(?:criterion_unmet|todo_open):/u;

/** Whether the only findings of an open acceptance are criteria that were not met or todos left open. */
function isNotPassed(acceptance: AgentPlanAcceptance | null): boolean {
  if (acceptance === null || acceptance.verdict === "accepted") return false;
  return (
    acceptance.issues.length > 0 &&
    acceptance.issues.every((issue) => UNMET_WORK_ISSUE.test(issue))
  );
}

/** The failure of a node and, for an agent a decision reads, whether its run passed. */
export interface PlanAcceptanceOutcome {
  readonly failure: ReturnType<typeof planAcceptanceFailure>;
  /** Set only for an agent whose boolean result a decision reads. */
  readonly passed?: boolean;
}

/**
 * Judges a node's acceptance, reporting `false` instead of a failure where a decision reads it.
 *
 * @param node - The node and whether a decision reads its boolean result.
 * @param acceptance - The reconciled report of the turn.
 */
export function planAcceptanceOutcome(
  node: PlanFailureNode & { readonly reportsPassed?: boolean },
  acceptance: AgentPlanAcceptance | null,
): PlanAcceptanceOutcome {
  const failure = planAcceptanceFailure(node, acceptance);
  if (!node.reportsPassed) return { failure };
  if (failure === null) return { failure: null, passed: true };
  return isNotPassed(acceptance)
    ? { failure: null, passed: false }
    : { failure };
}

/** Carries a safe filename diagnosis into run details without storage paths. */
export function assetFailure(
  error: unknown,
): Pick<AgentPlanStepResult, "assetFailure"> {
  if (error instanceof AgentAssetReferenceError)
    return {
      assetFailure: {
        id: "reference",
        name: error.fileName,
        cause: error.code,
      },
    };
  if (!(error instanceof AgentAssetError)) return {};
  return {
    assetFailure: {
      id: error.asset.id,
      name: error.fileName,
      cause: error.code,
    },
  };
}

/** A successful provider request still fails business execution when its structured answer is blocked. */
export function apiBusinessResult(
  output: string,
): Partial<AgentPlanStepResult> {
  const error = explicitPlanBlocker(output) ? "plan_acceptance_failed" : null;
  return { status: error ? "failed" : "succeeded", output, error };
}

/** Reports the actual failure after cleanup, keeping an earlier attempt's record when no new start occurred. */
export function planNodeFailureResult(
  node: NodeRun,
  error: unknown,
): Partial<AgentPlanStepResult> {
  const session = node.record ? { session: node.record } : {};
  if (node.record?.closeout === "failed")
    return { status: "failed", error: "plan_closeout_failed", ...session };
  if (hasPlanStepTimedOut(node.control.signal))
    return { status: "failed", error: "timeout", ...session };
  if (error instanceof AgentPlanCancelledError)
    return {
      status: "cancelled",
      cancellation: node.hasStarted ? "confirmed" : "not_started",
      ...session,
    };
  return {
    status: "failed",
    error: errorCode(error),
    ...session,
    ...assetFailure(error),
  };
}
