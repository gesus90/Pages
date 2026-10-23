import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { planStepExecutionSchema } from "@/definition/AgentPlanExecution";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { sanitizePlanOutput } from "@/backend/service/agents/AgentPlanOutput";
import { recordRemoteAgentResult } from "@/backend/service/agents/AgentPlanRemoteResult";
import { runnerPlanCheckpoint } from "./RunnerPlanCheckpoint";
import type {
  AgentPlanRun,
  AgentPlanStepResult,
  AgentPlanStepStatus,
} from "@/definition/AgentPlan";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";
import type { RunnerJob, RunnerMessage } from "@/definition/RunnerProtocol";

type PlanEvent = Extract<RunnerMessage, { type: "event" }>;
interface EventInput {
  readonly connectionId: string;
  readonly job: RunnerJob;
  readonly event?: PlanEvent;
}

function boundStep(
  input: EventInput,
  run: AgentPlanRun,
  snapshot: unknown,
): AgentPlanStepResult {
  const binding = input.job.plan;
  if (
    !binding ||
    binding.runId !== run.id ||
    binding.planId !== run.planId ||
    binding.planRevision !== run.planRevision
  )
    throw new Error("Runner plan identity mismatch");
  const basis = readAgentObject(readAgentObject(snapshot).execution);
  if (!Array.isArray(basis.steps))
    throw new Error("Runner snapshot identity missing");
  const execution = basis.steps
    .map((entry: unknown) => planStepExecutionSchema.parse(entry))
    .find((entry) => entry.stepId === binding.stepId);
  const step = run.steps.find((entry) => entry.id === binding.stepId);
  if (
    !execution ||
    !step ||
    execution.target.kind !== "remote" ||
    execution.target.connectionId !== input.connectionId ||
    execution.attemptId !== binding.attemptId ||
    execution.runId !== run.id ||
    planContentDigest(step.execution) !== planContentDigest(execution)
  )
    throw new Error("Runner attempt mismatch");
  return step;
}

function requireProgress(
  input: EventInput,
  run: AgentPlanRun,
  step: AgentPlanStepResult,
): void {
  if (run.status === "paused" || run.status === "succeeded")
    throw new Error("Runner run does not admit progress");
  if (!isActivePlanRun(run.status) && step.status !== "running")
    throw new Error("Runner terminal run only admits outstanding cleanup");
  if (step.status !== "waiting" && step.status !== "running")
    throw new Error("Runner step already terminal");
  requireCompletionEvidence(input);
}

function requireCompletionEvidence(input: EventInput): void {
  const { job, event } = input;
  if (job.status === "queued")
    throw new Error("Runner cannot dispatch from reconciliation");
  if ((job.status === "completed" || job.status === "failed") && !event?.result)
    throw new Error("Runner completion evidence required");
  if (job.status === "completed") requireSuccessfulCompletion(input);
}

function requireSuccessfulCompletion(input: EventInput): void {
  const result = input.event?.result;
  if (result?.closeout !== "confirmed")
    throw new Error("Runner completion requires confirmed cleanup");
  if (input.job.execution && (result.exitCode !== 0 || result.reason !== null))
    throw new Error("Runner successful exit evidence required");
}

function stepStatus(job: RunnerJob): AgentPlanStepStatus {
  if (job.status === "completed") return "succeeded";
  if (job.status === "interrupted") return "cancelled";
  if (job.status === "failed" || job.status === "lost") return "failed";
  return "running";
}

function updatedStep(
  input: EventInput,
  step: AgentPlanStepResult,
): AgentPlanStepResult {
  const { job, event } = input;
  if (job.status === "queued") throw new Error("Runner dispatch required");
  const status = stepStatus(job);
  const now = new Date().toISOString();
  const output =
    job.execution?.hasOutput === false
      ? null
      : (event?.result?.output ?? step.output);
  return {
    ...step,
    status,
    output: output === null ? null : sanitizePlanOutput(output),
    error: runnerFailureCode(job),
    ...(job.status === "interrupted"
      ? {
          cancellation:
            event?.result?.closeout === "confirmed"
              ? ("confirmed" as const)
              : ("requested" as const),
        }
      : {}),
    remote: remoteProgress(input, step, { now, status }),
  };
}

function remoteProgress(
  input: EventInput,
  step: AgentPlanStepResult,
  timing: { now: string; status: AgentPlanStepStatus },
): NonNullable<AgentPlanStepResult["remote"]> {
  const { job, event } = input;
  const { now, status } = timing;
  if (job.status === "queued") throw new Error("Runner launch required");
  return {
    jobId: job.jobId,
    sessionId: job.sessionId,
    status: job.status,
    ...(job.launch ? { launchId: job.launch.id } : {}),
    ...remoteResult(input),
    startedAt: step.remote?.startedAt ?? now,
    endedAt: status === "running" ? null : now,
    closeout: event?.result?.closeout ?? "pending",
  };
}

function remoteResult(
  input: EventInput,
): Pick<
  NonNullable<AgentPlanStepResult["remote"]>,
  "exitCode" | "signal" | "reason" | "stderr"
> {
  const result = input.event?.result;
  return {
    exitCode: result?.exitCode ?? null,
    signal: result?.signal ?? null,
    reason: result?.reason ?? null,
    stderr: sanitizePlanOutput(result?.stderr ?? ""),
  };
}

function runnerFailureCode(job: RunnerJob): string | null {
  if (job.status === "lost") return "plan_runner_lost";
  if (job.status === "interrupted") return "plan_interrupted";
  return job.status === "failed" ? "plan_runner_failed" : null;
}

function updatedRun(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
): AgentPlanRun {
  const steps = run.steps.map((entry) => (entry.id === step.id ? step : entry));
  const result = { ...run, steps };
  return result;
}

/** Applies only the attempt dispatched from this exact immutable snapshot and remote connection. */
export function applyRunnerPlanEvent(
  input: EventInput,
  run: AgentPlanRun,
  snapshot: unknown,
): {
  readonly run: AgentPlanRun;
  readonly checkpoint?: AgentPlanCheckpointInput;
} {
  const step = boundStep(input, run, snapshot);
  requireProgress(input, run, step);
  const updated = recordRemoteAgentResult(
    snapshot,
    input.job.execution,
    updatedStep(input, step),
  );
  const result = updatedRun(run, updated);
  return {
    run: result,
    ...(updated.status === "succeeded"
      ? { checkpoint: runnerPlanCheckpoint(result, snapshot, updated) }
      : {}),
  };
}
