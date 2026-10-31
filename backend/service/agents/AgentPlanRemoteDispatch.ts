import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";

/** How a retry distinguishes its fresh remote one-shot from the earlier job. */
export interface RemoteRetryTerms {
  /** Counts from 2 for the first retry; the original attempt is 1. */
  readonly attemptNumber: number;
  /** A finished job of the same attempt may be followed by exactly this new job. */
  readonly allowTerminalRerun: boolean;
}

export const CANCELLED_BEFORE_DISPATCH: Partial<AgentPlanStepResult> = {
  status: "cancelled",
  cancellation: "not_started",
  output: null,
  error: null,
};

/** One explicit remote selection, with an optional verified retry request. */
export interface RemoteDispatchRequest {
  readonly service: AgentPlanRemoteExecution | undefined;
  readonly active: ActivePlanRun;
  readonly stepId: string;
  readonly signal: AbortSignal;
  readonly retry?: RemoteRetryTerms;
}

/** Dispatches every explicit remote selection through the same contract, or refuses it. */
export function dispatchRemotePlanStep(
  request: RemoteDispatchRequest,
): Promise<Partial<AgentPlanStepResult>> | null {
  const { service, active, stepId, signal, retry } = request;
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
  if (!service) throw new AgentError("plan_remote_unavailable");
  if (signal.aborted) return Promise.resolve(CANCELLED_BEFORE_DISPATCH);
  if (active.view.status !== "running")
    return Promise.resolve({ status: "paused" });
  active.dispatched.add(stepId);
  return service
    .run(active.view, remote, signal, retry)
    .catch((error: unknown): Partial<AgentPlanStepResult> => {
      if (error instanceof AgentPlanPausedError) return { status: "paused" };
      throw error;
    });
}
