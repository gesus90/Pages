import { createHash } from "node:crypto";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { planStepExecutionSchema } from "@/definition/AgentPlanExecution";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { sanitizePlanOutput } from "@/backend/service/agents/AgentPlanOutput";
import { recordRemoteAgentResult } from "@/backend/service/agents/AgentPlanRemoteResult";
import { settleDetachedRun } from "@/backend/service/agents/AgentPlanRunState";
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
  /** No engine of this Pages process owns the run, for example after a restart. */
  readonly isDetached?: boolean;
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

/**
 * Whether the plan still takes progress of this step.
 *
 * A settled step keeps its result: a late or repeated runner fact is still
 * acknowledged in the runner journal, so it cannot block the events of every
 * other run on the same connection.
 */
function admitsProgress(run: AgentPlanRun, step: AgentPlanStepResult): boolean {
  if (run.status === "paused" || run.status === "succeeded") return false;
  if (!isActivePlanRun(run.status) && step.status !== "running") return false;
  return step.status === "waiting" || step.status === "running";
}

function requireCompletionEvidence(input: EventInput): void {
  const { job, event } = input;
  if (job.status === "queued" && (!event || event.result || job.launch))
    throw new Error("Runner queue status requires an unlaunched event");
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
  requireNativeTerminal(input.job, result);
}

function requireNativeTerminal(
  job: RunnerJob,
  result: NonNullable<PlanEvent["result"]>,
): void {
  if (job.outputJournalVersion === 2 && job.execution?.program.kind === "cli") {
    const terminal = result.terminal;
    if (
      !terminal ||
      terminal.status !== "completed" ||
      !terminal.sessionId ||
      terminal.provider !== job.execution.program.route.tool ||
      terminal.answerDigest !==
        createHash("sha256")
          .update(result.output ?? "")
          .digest("hex")
    )
      throw new Error("Runner native terminal evidence required");
  }
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
    error: event?.result?.resourceError ?? runnerFailureCode(job, input),
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
  return {
    jobId: job.jobId,
    sessionId: job.sessionId,
    status: job.status,
    ...(job.launch ? { launchId: job.launch.id } : {}),
    ...(job.liveHistoryVersion === 1 ? { liveHistoryVersion: 1 as const } : {}),
    ...(job.outputJournalVersion === 2
      ? { outputJournalVersion: 2 as const }
      : {}),
    ...remoteEvidence(event?.result),
    ...remoteResult(input),
    startedAt: step.remote?.startedAt ?? now,
    endedAt: status === "running" ? null : now,
    closeout: event?.result?.closeout ?? "pending",
  };
}

function remoteEvidence(
  result: PlanEvent["result"],
): Pick<
  NonNullable<AgentPlanStepResult["remote"]>,
  "terminal" | "storageError"
> {
  return {
    ...(result?.terminal ? { terminal: result.terminal } : {}),
    ...(result?.storageError ? { storageError: result.storageError } : {}),
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

function runnerFailureCode(job: RunnerJob, input: EventInput): string | null {
  if (job.status === "lost") return "plan_runner_lost";
  if (job.status === "interrupted") return "plan_interrupted";
  if (job.status !== "failed") return null;
  const result = input.event?.result;
  if (result?.failureCode) return result.failureCode;
  if (result?.reason === "storage") return "plan_runner_storage_failed";
  if (result?.reason === "protocol") return "plan_runner_incomplete";
  if (result?.reason === "event_limit") return "plan_runner_event_limit";
  if (result?.reason === "result_limit") return "plan_runner_result_limit";
  return "plan_runner_failed";
}

function updatedRun(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
  isDetached: boolean,
): AgentPlanRun {
  const steps = run.steps.map((entry) => (entry.id === step.id ? step : entry));
  const result: AgentPlanRun = { ...run, steps };
  // An engine closes its own runs; only a run without one settles here.
  return isDetached ? settleDetachedRun(result) : result;
}

/**
 * Applies only the attempt dispatched from this exact immutable snapshot and remote connection.
 *
 * @remarks
 * A step the plan has already settled stays unchanged and is marked
 * `isSettled`; a still queued job changes nothing either. In both cases the
 * returned run is the given object, so callers can skip the write. Queue,
 * observation and stop facts stay in the runner journal and are added when a
 * run is read, so stored run views keep the format of earlier versions.
 */
export function applyRunnerPlanEvent(
  input: EventInput,
  run: AgentPlanRun,
  snapshot: unknown,
): {
  readonly run: AgentPlanRun;
  readonly checkpoint?: AgentPlanCheckpointInput;
  readonly isSettled?: boolean;
} {
  const step = boundStep(input, run, snapshot);
  requireCompletionEvidence(input);
  if (!admitsProgress(run, step)) return { run, isSettled: true };
  if (input.job.status === "queued") return { run };
  const updated = recordRemoteAgentResult(
    snapshot,
    input.job.execution,
    updatedStep(input, step),
  );
  const result = updatedRun(run, updated, input.isDetached === true);
  return {
    run: result,
    ...(updated.status === "succeeded"
      ? { checkpoint: runnerPlanCheckpoint(result, snapshot, updated) }
      : {}),
  };
}
