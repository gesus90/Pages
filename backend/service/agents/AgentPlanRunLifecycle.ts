import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { withLogContext, logEvent } from "@/backend/logging/Logger";
import { planWritingWorkspaces } from "./AgentPlanContinuation";
import { requireWriterRepository } from "./AgentPlanEngineDependencies";
import {
  requestCancellation,
  finalPlanStatus,
  endedPlanRun,
  interruptedPlanRun,
  hasUnconfirmedCloseout,
} from "./AgentPlanRunState";
import { planRecoveryReason } from "./recovery/AgentPlanFailure";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Acquires all concrete writes before any scheduler node can dispatch. */
export async function acquirePlanWriters(
  active: ActivePlanRun,
  dependencies: EngineDependencies,
): Promise<boolean> {
  if (planWritingWorkspaces(active.snapshot).length === 0) return true;
  const repository = requireWriterRepository(dependencies.runs);
  const acquired = await repository.reserve(
    active.view.id,
    planWritingWorkspaces(active.snapshot),
  );
  const workspaceWait = acquired
    ? undefined
    : await repository.resourceBlocker(
        active.view,
        planWritingWorkspaces(active.snapshot),
      );
  if (
    Boolean(active.view.isWaitingForWorkspace) !== !acquired ||
    JSON.stringify(active.view.workspaceWait) !==
      JSON.stringify(workspaceWait ?? undefined)
  ) {
    active.view = {
      ...active.view,
      isWaitingForWorkspace: !acquired,
      workspaceWait: workspaceWait ?? undefined,
    };
    await dependencies.runs.update(active.view);
  }
  return acquired;
}

/** Stops only the predecessor retired by the new run's transaction, keeping its cleanup reservations. */
export async function retireActivePredecessor(
  view: AgentPlanRun,
  activeRuns: ReadonlyMap<string, ActivePlanRun>,
  dependencies: EngineDependencies,
): Promise<void> {
  if (view.origin?.kind === "restart") {
    const prior = activeRuns.get(view.origin.runId);
    if (prior && isActivePlanRun(prior.view.status)) {
      requestCancellation(prior);
      prior.view = {
        ...prior.view,
        status: "cancelled",
        endedAt: view.startedAt,
      };
      for (const controller of prior.controllers.values()) controller.abort();
    }
    const previous = await dependencies.runs.find(view.origin.runId);
    if (previous) await dependencies.remoteExecution?.stop(previous);
  }
}

/** Persists final business state and closes only resources whose process end is proven. */
export async function finalizeScheduledPlanRun(
  active: ActivePlanRun,
  dependencies: EngineDependencies,
): Promise<void> {
  const hasFailure = active.view.steps.some(
    (step) =>
      step.status === "failed" ||
      step.status === "waiting" ||
      step.status === "paused" ||
      step.isBlocked,
  );
  const status = finalPlanStatus(active, hasFailure);
  const recovery =
    status === "failed" ? planRecoveryReason(active.view) : undefined;
  active.view = {
    ...endedPlanRun(active.view, status),
    ...(recovery ? { recovery } : {}),
  };
  if (active.isInterrupted) active.view = interruptedPlanRun(active.view);
  await dependencies.runs.update(active.view);
  await dependencies.archive?.complete(active.view, active.snapshot);
  if (!hasUnconfirmedCloseout(active)) await active.releaseDefinition?.();
  withLogContext({ runId: active.view.id }, () =>
    logEvent({
      level: "info",
      event: "agent.run.completed",
      component: "AgentPlanRunEngine",
      message: "Agent plan run completed",
      metadata: { status },
    }),
  );
  dependencies.resources?.resumeRun(active.view.id);
}
