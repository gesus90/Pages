import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { AgentError } from "@/backend/error/AgentErrors";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerJob } from "@/definition/RunnerProtocol";

function matchesRecordedJob(
  step: AgentPlanStepResult,
  job: RunnerJob,
): boolean {
  return (
    !step.remote ||
    (step.remote.jobId === job.jobId && step.remote.sessionId === job.sessionId)
  );
}

/** Refuses cancellation if the journal and original attempt do not identify the same job. */
export function isOriginalRemoteJob(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
  job: RunnerJob | undefined,
): job is RunnerJob {
  const execution = step.execution;
  const binding = job?.plan;
  if (!job || !binding || execution?.target.kind !== "remote") return false;
  return (
    execution.planId === run.planId &&
    execution.runId === run.id &&
    execution.stepId === step.id &&
    binding.planId === run.planId &&
    binding.runId === run.id &&
    binding.stepId === step.id &&
    binding.attemptId === execution.attemptId &&
    binding.planRevision === execution.planRevision &&
    matchesRecordedJob(step, job)
  );
}

/** A queue-only pause never terminates a worker which already won its launch claim. */
export async function pauseQueuedRemoteRun(
  run: AgentPlanRun,
  runners: Pick<RunnerService, "progress">,
): Promise<void> {
  for (const step of allPlanRunResults(run)) {
    const execution = step.execution;
    if (execution?.target.kind !== "remote") continue;
    const job = await runners.progress(
      execution.target.connectionId,
      run.id,
      execution.attemptId,
    );
    if (!isOriginalRemoteJob(run, step, job) || job.status !== "queued")
      continue;
    if (!canPauseQueue(runners))
      throw new AgentError("plan_runner_control_update_required");
    await runners.pauseQueued(execution.target.connectionId, job.jobId);
  }
}

function canPauseQueue(
  runners: Pick<RunnerService, "progress">,
): runners is Pick<RunnerService, "progress"> &
  Pick<RunnerService, "pauseQueued"> {
  return "pauseQueued" in runners && typeof runners.pauseQueued === "function";
}
