import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";

import { dispatchRemotePlanStep } from "./AgentPlanRemoteDispatch";
import { runPlanStepWithRetry } from "./AgentPlanStepRetry";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";

interface RemoteRetryDependencies {
  readonly service: AgentPlanRemoteExecution;
  readonly runs: Partial<Pick<AgentPlanRunRepository, "resetRemoteRetry">>;
}

const CANCELLED_BEFORE_DISPATCH: Partial<AgentPlanStepResult> = {
  status: "cancelled",
  cancellation: "not_started",
  output: null,
  error: null,
};

/** Whether a remote one-shot cannot mutate anything and may safely start over. */
function isReadOnlyRemote(active: ActivePlanRun, stepId: string): boolean {
  const command = active.snapshot.remoteSteps?.find(
    (entry) => entry.step.id === stepId,
  )?.command;
  if (!command) return false;
  return (
    command.program.kind !== "cli" || command.program.access === "read_only"
  );
}

/** Reopens the stored remote projection before the next job can be admitted. */
async function resetRemoteStep(
  active: ActivePlanRun,
  stepId: string,
  session: NonNullable<AgentPlanStepResult["session"]>,
  dependencies: RemoteRetryDependencies,
): Promise<NonNullable<AgentPlanStepResult["session"]> | null> {
  const reset = dependencies.runs.resetRemoteRetry;
  if (!reset) throw new AgentError("plan_remote_unavailable");
  const next = await reset(active.view.id, stepId, session);
  active.view = next;
  return next.steps.find((entry) => entry.id === stepId)?.session ?? null;
}

/**
 * Retries a remote one-shot after a technical session failure.
 *
 * @remarks
 * A remote job has no native resume and keeps no tool trace. Only reading
 * work can safely start again; writing work stays blocked as `unsafe` and
 * needs the explicit recovery review.
 */
export function dispatchRemoteStepWithRetry(
  dependencies: RemoteRetryDependencies | undefined,
  active: ActivePlanRun,
  stepId: string,
  signal: AbortSignal,
): Promise<Partial<AgentPlanStepResult>> | null {
  const remote = active.snapshot.remoteSteps?.find(
    (entry) => entry.step.id === stepId,
  );
  if (!remote) {
    const local = active.snapshot.steps.find(
      (entry) => entry.step.id === stepId,
    );
    if (local?.remoteTarget || local?.step.executionTarget?.kind === "remote")
      throw new AgentError("plan_remote_unavailable");
    return null;
  }
  if (!dependencies) throw new AgentError("plan_remote_unavailable");
  if (signal.aborted) return Promise.resolve(CANCELLED_BEFORE_DISPATCH);
  if (active.view.status !== "running")
    return Promise.resolve({ status: "paused" });
  let lastSession =
    active.view.steps.find((entry) => entry.id === stepId)?.session ?? null;
  let hasDispatched = false;
  const isReadOnly = isReadOnlyRemote(active, stepId);
  return runPlanStepWithRetry({
    signal,
    previous: lastSession?.retry ?? null,
    isSharedSession: false,
    isRemote: true,
    isReadOnly,
    lastSession: () => lastSession,
    attempt: async (context) => {
      if (context.attemptNumber > 1 && lastSession)
        lastSession =
          (await resetRemoteStep(active, stepId, lastSession, dependencies)) ??
          lastSession;
      hasDispatched = true;
      const result = await dispatchRemotePlanStep({
        service: dependencies.service,
        active,
        stepId,
        signal,
        retry:
          context.attemptNumber > 1
            ? {
                attemptNumber: context.attemptNumber,
                allowTerminalRerun: true,
              }
            : undefined,
      });
      if (!result) throw new AgentError("plan_context_changed");
      lastSession = result.session ?? lastSession;
      return result;
    },
    waiting: () => {
      active.dispatched.delete(stepId);
    },
    save: async (retry) => {
      if (!lastSession) return null;
      lastSession = await resetRemoteStep(
        active,
        stepId,
        { ...lastSession, retry },
        dependencies,
      );
      return lastSession;
    },
  }).catch(async (error: unknown): Promise<Partial<AgentPlanStepResult>> => {
    if (signal.reason instanceof AgentPlanPausedError)
      return { status: "paused" };
    if (signal.aborted) {
      await cancelRemoteRetry(active, stepId, lastSession, dependencies);
      return hasDispatched
        ? {
            status: "cancelled",
            cancellation: "requested",
            output: null,
            error: null,
          }
        : CANCELLED_BEFORE_DISPATCH;
    }
    throw error;
  });
}

/** Keeps the spent budget and attempts while ending a stored wait with Stop or recovery. */
async function cancelRemoteRetry(
  active: ActivePlanRun,
  stepId: string,
  session: NonNullable<AgentPlanStepResult["session"]> | null,
  dependencies: RemoteRetryDependencies,
): Promise<void> {
  if (!session?.retry) return;
  try {
    await resetRemoteStep(
      active,
      stepId,
      {
        ...session,
        retry: { ...session.retry, state: "cancelled", nextAttemptAt: null },
      },
      dependencies,
    );
  } catch {
    // The run is already ending; the engine keeps the last durable record.
  }
}
