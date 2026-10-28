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
