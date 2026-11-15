import { AgentError } from "@/backend/error/AgentErrors";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import {
  captureLogContext,
  logCaughtError,
  logDiagnostic,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";

import { capturePlanExecution } from "./AgentPlanExecutionSnapshot";
import { hasRemotePlanTarget } from "./AgentPlanExecutionTargets";
import { planWritingWorkspaces } from "./AgentPlanContinuation";
import { retireActivePredecessor } from "./AgentPlanRunLifecycle";
import { sharedAgentPlanRunObservers } from "./AgentPlanRunObservers";
import { endedPlanRun, requestCancellation } from "./AgentPlanRunState";

import type { SerialQueue } from "@/backend/concurrency/SerialQueue";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";
import type { AgentPlanRunRecording } from "./AgentPlanRunRecording";
import type { ActivePlanRun } from "./AgentPlanRunState";

/** Label of the database jobs of plan runs in the write-ahead log counters. */
export const PLAN_RUN_ORIGIN = "plan_run";

/** Runtime state and callbacks needed to launch or abort a starting plan run. */
export interface PlanEngineLaunchHost {
  readonly dependencies: EngineDependencies;
  readonly active: Map<string, ActivePlanRun>;
  readonly writes: SerialQueue;
  readonly pump: () => Promise<void>;
}

/** Recording/journal terms for creating a new run record. */
export interface PlanLaunchTerms {
  readonly recording?: AgentPlanRunRecording;
  readonly journal?: AgentPlanRunJournal;
}

/** Persists the run snapshot and reserves writing copies before scheduling its first step. */
export async function launchPlanRun(
  host: PlanEngineLaunchHost,
  initialView: AgentPlanRun,
  initialSnapshot: AgentPlanSnapshot,
  terms: PlanLaunchTerms,
): Promise<AgentPlanRun> {
  const { dependencies, active, writes, pump } = host;
  if (
    (hasRemotePlanTarget(initialSnapshot.plan) ||
      initialSnapshot.steps.some((step) => step.remoteTarget)) &&
    !dependencies.remoteExecution
  )
    throw new AgentError("plan_remote_unavailable");
  const { recording, journal } = terms;
  const captured = capturePlanExecution(initialView, initialSnapshot);
  const view = captured.run;
  const snapshot = captured.snapshot;
  const logContext = { ...captureLogContext(), runId: view.id };
  withLogContext(logContext, () =>
    logEvent({
      level: "info",
      event: "agent.run.started",
      component: "AgentPlanRunEngine",
      message: "Agent plan run starting",
      metadata: { userId: view.userId, origin: view.origin?.kind ?? null },
    }),
  );
  await dependencies.runs.prepareSnapshot?.(view.id, snapshot);
  const workspaceIds = planWritingWorkspaces(snapshot);
  const releaseDefinition = await dependencies.files?.hold(
    snapshot.steps.map((step) => step.step.agentId),
  );
  await writes.run(async () => {
    try {
      if (recording)
        await recording((transaction) =>
          dependencies.runs.insert(transaction, view, snapshot, workspaceIds),
        );
      else
        await dependencies.runs.create(view, snapshot, workspaceIds, journal);
    } catch (error: unknown) {
      logCaughtError("AgentPlanRunEngine", error);
      await releaseDefinition?.();
      throw error;
    }
    sharedAgentPlanRunObservers().notifyStarted(view);
    // The run exists from here on, so its lifecycle no longer hangs on the request.
    await withBackgroundDatabaseWork(PLAN_RUN_ORIGIN, () =>
      retireActivePredecessor(view, active, dependencies),
    );
    active.set(view.id, {
      logContext,
      groupCloseout: "open",
      hasPersistenceFailure: false,
      view,
      snapshot,
      dispatched: new Set(),
      controllers: new Map(),
      executions: new Set(),
      releaseDefinition,
    });
  });
  return withBackgroundDatabaseWork(PLAN_RUN_ORIGIN, async () => {
    try {
      await pump();
      return (await dependencies.runs.find(view.id)) ?? view;
    } catch (error: unknown) {
      logCaughtError("AgentPlanRunEngine", error);
      await failPlanRunStart(host, view.id);
      throw error;
    }
  });
}

/** Finalizes or drains an active run whose initial scheduling pump failed. */
export async function failPlanRunStart(
  host: PlanEngineLaunchHost,
  id: string,
): Promise<void> {
  const { dependencies, active, pump } = host;
  const entry = active.get(id);
  if (!entry) return;
  requestCancellation(entry);
  for (const controller of entry.controllers.values()) controller.abort();
  if (
    entry.executions.size > 0 ||
    entry.view.steps.some((step) => step.session) ||
    (entry.view.loops?.some((loop) =>
      loop.iterations.some((iteration) =>
        iteration.nodes.some((node) => node.session),
      ),
    ) ??
      false)
  ) {
    await Promise.all([...entry.executions]);
    // Running adapters settle before normal finalization releases their definitions.
    try {
      await pump();
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
  entry.view = {
    ...endedPlanRun(entry.view, "failed"),
    steps: entry.view.steps.map((step) => ({
      ...step,
      status: "cancelled",
      cancellation: "not_started",
    })),
  };
  await entry.releaseDefinition?.();
  active.delete(id);
  try {
    await dependencies.runs.update(entry.view);
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
