import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { patchStep } from "./AgentPlanRunState";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

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
      patchStep(active, stepId, { session });
      await dependencies.runs.update(active.view);
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
