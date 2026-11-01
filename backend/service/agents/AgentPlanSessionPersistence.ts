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
      if (!isActivePlanRun(active.view.status)) return;
      const previous = active.view;
      const current = previous.steps.find((step) => step.id === stepId);
      const merged =
        current?.status === "succeeded"
          ? preserveCompletedSession(current.session, session)
          : session;
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
