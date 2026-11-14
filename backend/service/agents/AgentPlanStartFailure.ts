import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { endedPlanRun, requestCancellation } from "./AgentPlanRunState";

import type { EngineDependencies } from "./AgentPlanEngineDependencies";
import type { ActivePlanRun } from "./AgentPlanRunState";

/** Engine state that settling a failed plan start reads and updates. */
export interface PlanStartFailureContext {
  /** Runs this process still drives, keyed by run identifier. */
  readonly active: Map<string, ActivePlanRun>;
  readonly dependencies: EngineDependencies;
  /** Advances the remaining runs once the failed start has settled. */
  readonly pump: () => Promise<void>;
}

/**
 * Settles a run whose start failed.
 *
 * @param id - The run whose start failed.
 * @param context - The engine state the settlement reads and updates.
 * @remarks
 * A run that already has started nodes or stored sessions waits for them to
 * settle and is finalized by the normal pump. A run without any is ended as
 * failed right here, and its cancelled steps are persisted.
 */
export async function settleFailedPlanStart(
  id: string,
  context: PlanStartFailureContext,
): Promise<void> {
  const active = context.active.get(id);
  if (!active) return;
  requestCancellation(active);
  for (const controller of active.controllers.values()) controller.abort();
  if (
    active.executions.size > 0 ||
    allPlanRunResults(active.view).some((step) => step.session)
  ) {
    await Promise.all([...active.executions]);
    // Running adapters settle before normal finalization releases their definitions.
    try {
      await context.pump();
    } catch (error: unknown) {
      logCaughtError("AgentPlanRunEngine", error);

      logDiagnostic(
        "AgentPlanRunEngine",
        "error",
        "Pages could not finalize a failed plan start.",
        error,
      );
    }
    return;
  }
  active.view = {
    ...endedPlanRun(active.view, "failed"),
    steps: active.view.steps.map((step) => ({
      ...step,
      status: "cancelled",
      cancellation: "not_started",
    })),
  };
  await active.releaseDefinition?.();
  context.active.delete(id);
  try {
    await context.dependencies.runs.update(active.view);
  } catch (error: unknown) {
    logCaughtError("AgentPlanRunEngine", error);

    logDiagnostic(
      "AgentPlanRunEngine",
      "error",
      "Pages could not persist a failed plan start; reservations remain held.",
      error,
    );
  }
}
