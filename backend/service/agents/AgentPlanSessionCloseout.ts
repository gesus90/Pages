import { LocalControlCommandError } from "@/backend/agents/local/LocalControlFailure";
import { AgentError } from "@/backend/error/AgentErrors";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

import { hasEndedLeaseProcesses } from "./resources/AcpLeaseProcesses";
import {
  hasPlanStepTimedOut,
  planCompletedFailure,
  turnFailureCode,
} from "./AgentPlanSessionRecords";

import type {
  PlanSession,
  PlanSessionTurn,
  PlanSessionClosed,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** Native closeout, or independent containment evidence after a control failure. */
export interface PlanSessionCloseout {
  readonly closed: PlanSessionClosed;
  readonly hasRecovered: boolean;
}

function canReconcileClose(
  error: unknown,
  record: AgentPlanSessionRecord | null,
): error is AgentError {
  if (!(error instanceof AgentError)) return false;
  if (error.code === "plan_local_control_failed") return true;
  return (
    error.code === "plan_local_owner_unverified" &&
    record?.acceptance?.verdict === "accepted"
  );
}

/**
 * Preserves the turn verdict only when the recorded namespace has certainly ended.
 * Lost owner proof recovers only for accepted work with independently proven process end.
 * Actual unconfirmed native closeout results never recover here.
 */
export async function closePlanSession(
  session: PlanSession,
  record: AgentPlanSessionRecord | null,
): Promise<PlanSessionCloseout> {
  try {
    return { closed: await session.close(), hasRecovered: false };
  } catch (error: unknown) {
    if (!canReconcileClose(error, record)) throw error;
    const hasEnded = record
      ? await hasEndedLeaseProcesses(
          record.instanceId,
          record.namespace,
        ).catch(() => false)
      : false;
    const reason =
      error instanceof LocalControlCommandError ? error.detail : error.code;
    logEvent({
      level: "warn",
      event: "plan.session.close_reconciled",
      component: "AgentPlanStepRunner",
      message: hasEnded
        ? `Local close failed (${reason}); independent namespace and worker evidence confirms no remaining processes. Turn result retained.`
        : `Local close failed (${reason}); remaining processes could not be ruled out.`,
      metadata: {
        code: error.code,
        ...(error instanceof LocalControlCommandError
          ? { reason: error.detail }
          : {}),
        isConfirmed: hasEnded,
      },
    });
    if (!hasEnded) throw new AcpCleanupUnconfirmedError();
    return {
      hasRecovered: true,
      closed: {
        exit: record?.exit ?? null,
        endedAt: new Date().toISOString(),
        leftovers: 0,
        isConfirmed: true,
        containment: "pid_namespace",
      },
    };
  }
}

/** Keeps deadline and turn failures when independent evidence replaces a failed close command. */
export function planSessionCloseoutFailure(
  turn: PlanSessionTurn,
  closeout: PlanSessionCloseout,
  signal: AbortSignal,
): string | null {
  if (closeout.hasRecovered && !hasPlanStepTimedOut(signal))
    return turnFailureCode(turn);
  return planCompletedFailure(turn, closeout.closed, signal);
}

/** Ends a started session also when turn evaluation or closeout fails. */
export async function finishStartedPlanSession(
  session: PlanSession,
  finish: () => Promise<Partial<AgentPlanStepResult>>,
): Promise<Partial<AgentPlanStepResult>> {
  try {
    return await finish();
  } catch (error: unknown) {
    logCaughtError("AgentPlanStepRunner", error);
    await session.close().catch((closeError: unknown) => {
      logCaughtError("AgentPlanStepRunner", closeError);
      logDiagnostic(
        "AgentPlanStepRunner",
        "error",
        "Pages could not close an agent session.",
        closeError,
      );
    });
    throw error;
  }
}
