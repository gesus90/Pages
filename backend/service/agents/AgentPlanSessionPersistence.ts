import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { patchStep } from "./AgentPlanRunState";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

function preserveCompletedSession(
  existing: AgentPlanSessionRecord | null | undefined,
  next: AgentPlanSessionRecord,
): AgentPlanSessionRecord {
  if (!existing) return next;
  return {
    ...next,
    instanceId: existing.instanceId,
    runner: existing.runner,
    mode: existing.mode,
    attemptId: existing.attemptId,
    sessionId: existing.sessionId,
    requested: existing.requested,
    definition: existing.definition,
    contract: existing.contract,
    acceptance: existing.acceptance,
    dispatchedPromptDigest: existing.dispatchedPromptDigest,
    resultCode:
      existing.acceptance?.verdict === "accepted" &&
      next.closeout === "confirmed"
        ? 0
        : next.resultCode,
  };
}

/** Accepts cleanup evidence for the stopped attempt without changing its frozen work. */
function stoppedSession(
  existing: AgentPlanSessionRecord | null | undefined,
  next: AgentPlanSessionRecord,
): AgentPlanSessionRecord | null {
  if (
    !existing ||
    existing.instanceId !== next.instanceId ||
    existing.attemptId !== next.attemptId ||
    !["confirmed", "failed"].includes(next.closeout)
  )
    return null;
  if (existing.closeout === "confirmed") return existing;
  return {
    ...existing,
    closeout: next.closeout,
    containment: next.containment,
    leftoverProcesses: next.leftoverProcesses,
    exit: next.exit,
    endedAt: next.endedAt,
    events: next.events,
  };
}

/** Preserves reservations and closes dispatch if a session journal cannot be persisted. */
export async function savePlanSession(
  active: ActivePlanRun,
  stepId: string,
  session: AgentPlanSessionRecord,
  dependencies: {
    readonly writes: SerialQueue;
    readonly runs: Pick<AgentPlanRunRepository, "update">;
  },
): Promise<void> {
  try {
    await dependencies.writes.run(async () => {
      const previous = active.view;
      const isStopped =
        previous.status === "cancelled" && previous.stopRequested;
      if (!isActivePlanRun(previous.status) && !isStopped) return;
      const current = previous.steps.find((step) => step.id === stepId);
      let merged: AgentPlanSessionRecord | null = session;
      if (isStopped) merged = stoppedSession(current?.session, session);
      else if (current?.status === "succeeded")
        merged = preserveCompletedSession(current.session, session);
      if (!merged) return;
      patchStep(active, stepId, { session: merged });
      try {
        await dependencies.runs.update(active.view);
      } catch (error: unknown) {
        active.view = previous;
        throw error;
      }
    });
  } catch (error: unknown) {
    logCaughtError("AgentPlanRunEngine", error);

    logDiagnostic(
      "AgentPlanRunEngine",
      "error",
      "Pages could not store the record of an agent node.",
      error,
    );
    active.hasPersistenceFailure = true;
    for (const controller of active.controllers.values()) controller.abort();
  }
}
