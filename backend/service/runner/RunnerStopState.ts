import { settleDetachedRun } from "@/backend/service/agents/AgentPlanRunState";
import { isOriginalRemoteJob } from "@/backend/service/agents/AgentPlanRemoteCancellation";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerJob } from "@/definition/RunnerProtocol";

/** The server deadline reports uncertainty; only host evidence confirms physical cleanup. */
export const RUNNER_STOP_DEADLINE_MILLISECONDS = 60_000;

function stoppedStatus(
  step: AgentPlanStepResult,
  closeout: "confirmed" | "failed",
): AgentPlanStepResult["status"] {
  if (step.status !== "running") return step.status;
  return closeout === "confirmed" ? "cancelled" : "failed";
}

function stopError(
  step: AgentPlanStepResult,
  closeout: "confirmed" | "failed",
): string | null {
  if (
    step.status === "failed" &&
    step.error &&
    step.error !== "plan_stop_unconfirmed"
  )
    return step.error;
  if (closeout !== "confirmed") return "plan_stop_unconfirmed";
  return step.error === "plan_stop_unconfirmed" ? null : step.error;
}

function hasSameEvidence(
  step: AgentPlanStepResult,
  job: RunnerJob,
  closeout: "confirmed" | "failed",
): boolean {
  return (
    step.status !== "running" &&
    step.remote?.closeout === closeout &&
    step.remote.cancellation?.requestedAt === job.cancellation?.requestedAt &&
    step.remote.cancellation?.completedAt === job.cancellation?.completedAt
  );
}

function stoppedStep(
  run: AgentPlanRun,
  job: RunnerJob,
  connectionId: string,
): AgentPlanStepResult | null {
  if (
    !job.plan ||
    !job.cancellation ||
    run.status === "succeeded" ||
    (!run.stopRequested && isActivePlanRun(run.status))
  )
    return null;
  const binding = job.plan;
  const step = run.steps.find((entry) => entry.id === binding.stepId);
  if (
    !step ||
    step.execution?.target.kind !== "remote" ||
    step.execution.target.connectionId !== connectionId ||
    !isOriginalRemoteJob(run, step, job) ||
    step.status === "succeeded"
  )
    return null;
  return step;
}

/** Applies an exact attempt's cleanup evidence without reopening terminal work or replacing results. */
export function runnerStoppedRun(
  run: AgentPlanRun,
  job: RunnerJob,
  isDetached: boolean,
  connectionId: string,
): AgentPlanRun {
  const step = stoppedStep(run, job, connectionId);
  if (!step) return run;
  const now = new Date().toISOString();
  const closeout = job.cancellation?.closeout ?? "failed";
  if (hasSameEvidence(step, job, closeout)) return run;
  const updated: AgentPlanStepResult = {
    ...step,
    status: stoppedStatus(step, closeout),
    cancellation: closeout === "confirmed" ? "confirmed" : "requested",
    error: stopError(step, closeout),
    remote: {
      ...step.remote,
      jobId: job.jobId,
      sessionId: job.sessionId,
      status: job.status,
      cancellation: job.cancellation,
      startedAt: step.remote?.startedAt ?? null,
      endedAt: step.remote?.endedAt ?? now,
      closeout,
    },
    ...(step.session
      ? {
          session: {
            ...step.session,
            closeout,
            endedAt: step.session.endedAt ?? now,
          },
        }
      : {}),
  };
  const result = {
    ...run,
    steps: run.steps.map((entry) =>
      entry.id === updated.id ? updated : entry,
    ),
  };
  return isDetached ? settleDetachedRun(result) : result;
}
