import { hasEndedOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { AgentError } from "@/backend/error/AgentErrors";
import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";

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

/**
 * Preserves the turn verdict only when the recorded namespace has certainly ended.
 * Authentication failures and actual unconfirmed closeout results never recover here.
 */
export async function closePlanSession(
  session: PlanSession,
  record: AgentPlanSessionRecord | null,
): Promise<PlanSessionCloseout> {
  try {
    return { closed: await session.close(), hasRecovered: false };
  } catch (error: unknown) {
    if (
      !(error instanceof AgentError) ||
      error.code !== "plan_local_control_failed"
    )
      throw error;
    const hasEnded = record?.namespace
      ? await hasEndedOwnedNamespace(record.namespace).catch(() => false)
      : false;
    logEvent({
      level: "warn",
      event: "plan.session.close_reconciled",
      component: "AgentPlanStepRunner",
      message: hasEnded
        ? "Local close failed; independent namespace evidence confirms no remaining processes. Turn result retained."
        : "Local close failed; remaining processes could not be ruled out.",
      metadata: { code: error.code, isConfirmed: hasEnded },
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
