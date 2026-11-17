import { sanitizePlanOutput } from "@/backend/service/agents/AgentPlanOutput";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { settleManagedRunnerLoops } from "./RunnerManagedLoops";

import type { PlanRunnerJob } from "@/definition/PlanRunnerJob";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";
import type { RunnerJob, RunnerJobResult } from "@/definition/RunnerProtocol";

interface ManagedProjectionInput {
  readonly connectionId: string;
  readonly job: RunnerJob;
  readonly result?: RunnerJobResult;
  readonly isDetached: boolean;
}

interface ManagedCloseoutInput {
  readonly job: RunnerJob;
  readonly result: RunnerJobResult;
  readonly reference: PlanRunnerJob;
}

/** Projects ownership without letting a process receipt substitute for business acceptance. */
export function projectManagedRunnerJob(
  run: AgentPlanRun,
  input: ManagedProjectionInput,
): AgentPlanRun {
  const { job, result } = input;
  const binding = job.plan;
  if (
    !binding?.managed ||
    binding.runId !== run.id ||
    binding.planId !== run.planId
  )
    return run;
  const isDetached =
    input.isDetached || run.stopRequested || !isActivePlanRun(run.status);
  const incoming = runnerJobReference(job, binding, result, input.connectionId);
  const previous = run.runnerJobs?.find(
    (entry) => entry.jobId === incoming.jobId,
  );
  if (previous && !hasSameJobIdentity(previous, incoming)) return run;
  const reference = previous?.closeout === "confirmed" ? previous : incoming;
  const runnerJobs = mergeRunnerJobs(run, reference);
  const update = (step: AgentPlanStepResult): AgentPlanStepResult => {
    // The attached engine owns acceptance, session retention and its journal.
    if (!isDetached || !result || reference.closeout === "pending") return step;
    return closeDetachedStep(step, { job, result, reference });
  };
  const projected: AgentPlanRun = {
    ...run,
    runnerJobs,
    steps: run.steps.map(update),
    loops: run.loops?.map((loop) => ({
      ...loop,
      iterations: loop.iterations.map((iteration) => ({
        ...iteration,
        nodes: iteration.nodes.map(update),
      })),
    })),
  };
  return isDetached ? settleManagedRunnerLoops(projected) : projected;
}

function closeDetachedStep(
  step: AgentPlanStepResult,
  input: ManagedCloseoutInput,
): AgentPlanStepResult {
  const session = closeDetachedSession(step.session, input);
  const script = closeDetachedScript(step.script, input);
  if (session === step.session && script === step.script) return step;
  return {
    ...step,
    ...(step.status === "running"
      ? {
          status: "failed",
          error: "plan_interrupted",
          output: sanitizePlanOutput(input.result.output ?? ""),
        }
      : {}),
    ...(session ? { session } : {}),
    ...(script ? { script } : {}),
  };
}

function closeDetachedSession(
  record: AgentPlanSessionRecord | null | undefined,
  input: ManagedCloseoutInput,
): AgentPlanSessionRecord | null | undefined {
  const { job, result, reference } = input;
  if (!record || record.closeout === "confirmed") return record;
  const hasAttempt =
    job.plan?.recordingAttemptId !== undefined &&
    record.attemptId === job.plan.recordingAttemptId;
  if (record.runnerJob ? record.runnerJob.jobId !== job.jobId : !hasAttempt)
    return record;
  const endedAt = record.turnEndedAt ?? new Date().toISOString();
  return {
    ...record,
    closeout: reference.closeout,
    endedAt,
    turnEndedAt: endedAt,
    sessionId: result.terminal?.sessionId ?? record.sessionId,
    exit: { code: result.exitCode ?? null, signal: result.signal ?? null },
    ...(reference.closeout === "confirmed" &&
    job.launch?.isolation === "pid_namespace"
      ? { containment: "pid_namespace" }
      : {}),
  };
}

function closeDetachedScript(
  record: AgentPlanScriptRun | undefined,
  input: ManagedCloseoutInput,
): AgentPlanScriptRun | undefined {
  const { job, result, reference } = input;
  if (!record || record.closeout === "confirmed") return record;
  const hasAttempt = record.attemptId === job.plan?.attemptId;
  if (record.runnerJob ? record.runnerJob.jobId !== job.jobId : !hasAttempt)
    return record;
  return {
    ...record,
    closeout: reference.closeout,
    endedAt: record.endedAt ?? new Date().toISOString(),
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    stdout:
      record.stdout ??
      (result.output === null ? null : sanitizePlanOutput(result.output)),
  };
}

function runnerJobReference(
  job: RunnerJob,
  binding: NonNullable<RunnerJob["plan"]>,
  result: RunnerJobResult | undefined,
  connectionId: string,
): PlanRunnerJob {
  return {
    connectionId,
    jobId: job.jobId,
    attemptId: binding.attemptId,
    recordingAttemptId: binding.recordingAttemptId,
    stepId: binding.stepId,
    ownerStepId: binding.ownerStepId ?? binding.stepId,
    status: job.status,
    closeout:
      result?.closeout ??
      job.cancellation?.closeout ??
      job.outcome?.closeout ??
      "pending",
  };
}

function hasSameJobIdentity(
  previous: PlanRunnerJob,
  incoming: PlanRunnerJob,
): boolean {
  return (
    previous.connectionId === incoming.connectionId &&
    previous.attemptId === incoming.attemptId &&
    previous.recordingAttemptId === incoming.recordingAttemptId &&
    previous.stepId === incoming.stepId &&
    previous.ownerStepId === incoming.ownerStepId
  );
}

function mergeRunnerJobs(
  run: AgentPlanRun,
  reference: PlanRunnerJob,
): readonly PlanRunnerJob[] {
  const previous = run.runnerJobs ?? [];
  return previous.some((entry) => entry.jobId === reference.jobId)
    ? previous.map((entry) =>
        entry.jobId === reference.jobId ? reference : entry,
      )
    : [...previous, reference];
}
