import { claudeRunUsageSchema } from "@/definition/ClaudeUsage";
import { planRunCommandReceiptSchema } from "@/definition/PagesRuns";
import { planResourceReleaseSchema } from "@/definition/AgentPlanResourceRelease";
import { planWriterWaitSchema } from "@/definition/AgentPlanExecution";
import { isPlanWriterWaitActive } from "@/definition/AgentPlanRunState";
import { AgentError } from "@/backend/error/AgentErrors";

import {
  readPlanContinuation,
  readPlanPauseBoundary,
} from "./AgentPlanContinuationInput";
import { readPlanText } from "./AgentPlanInput";
import { readPlanLoopRuns } from "./AgentPlanLoopRunInput";
import { readPlanStepResult } from "./AgentPlanStepResultInput";
import { readPlanStackRuns } from "./AgentPlanStackRunInput";
import { readAgentObject } from "./AgentPayload";
import {
  readPlanRecoveryReason,
  readPlanRunOrigin,
} from "./AgentPlanRecoveryInput";

import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Narrows a persisted public view; private snapshots are never deserialized into route responses. */
export function readPlanRun(input: unknown): AgentPlanRun {
  const run = readAgentObject(input);
  const { status, planRevision, stopRequested } = run;
  if (!isRunStatus(status)) throw new AgentError("plan_invalid");
  if (
    typeof planRevision !== "number" ||
    !Number.isSafeInteger(planRevision) ||
    planRevision < 1 ||
    typeof stopRequested !== "boolean" ||
    !Array.isArray(run.steps) ||
    run.steps.length > 100
  )
    throw new AgentError("plan_invalid");
  return {
    id: readPlanText(run.id),
    ...readClaudeUsage(run.claudeUsage),
    planId: readPlanText(run.planId),
    planName: readPlanText(run.planName, 120),
    userId: readPlanText(run.userId),
    startedAt: readPlanText(run.startedAt),
    ...(run.endedAt === undefined
      ? {}
      : { endedAt: readPlanText(run.endedAt) }),
    ...readRunCommand(run.command),
    planRevision,
    status,
    stopRequested,
    ...readCleanup(run),
    ...readWriterWait(run, { status, stopRequested }),
    ...(run.controlError === "plan_step_failed" ||
    run.controlError === "plan_stop_unconfirmed"
      ? { controlError: run.controlError }
      : {}),
    ...readPlanPauseBoundary(run.pauseBoundary),
    ...readPlanContinuation(run.continuation),
    ...(run.recovery === undefined
      ? {}
      : { recovery: readPlanRecoveryReason(run.recovery) }),
    ...(run.origin === undefined
      ? {}
      : { origin: readPlanRunOrigin(run.origin) }),
    steps: run.steps.map(readPlanStepResult),
    ...(run.loops === undefined ? {} : { loops: readPlanLoopRuns(run.loops) }),
    ...(run.stacks === undefined
      ? {}
      : { stacks: readPlanStackRuns(run.stacks) }),
  };
}

function readCleanup(
  run: Readonly<Record<string, unknown>>,
): Pick<AgentPlanRun, "resourceReleases" | "startCleanupUnconfirmed"> {
  return {
    ...(run.resourceReleases === undefined
      ? {}
      : {
          resourceReleases: planResourceReleaseSchema
            .array()
            .parse(run.resourceReleases),
        }),
    ...(run.startCleanupUnconfirmed === undefined
      ? {}
      : {
          startCleanupUnconfirmed: readCleanupWarnings(
            run.startCleanupUnconfirmed,
          ),
        }),
  };
}

function readCleanupWarnings(input: unknown): readonly string[] {
  if (!Array.isArray(input)) throw new AgentError("plan_invalid");
  return input.map((entry: unknown) => readPlanText(entry));
}

function readWriterWait(
  run: Readonly<Record<string, unknown>>,
  state: Pick<AgentPlanRun, "status" | "stopRequested">,
): Pick<AgentPlanRun, "workspaceWait" | "isWaitingForWorkspace"> {
  // Validate retained annotations even when their old dispatch wait is no longer live.
  const workspaceWait =
    run.workspaceWait === undefined
      ? undefined
      : planWriterWaitSchema.parse(run.workspaceWait);
  if (
    !isPlanWriterWaitActive({
      ...state,
      isWaitingForWorkspace: run.isWaitingForWorkspace === true,
    })
  )
    return {};
  return {
    isWaitingForWorkspace: true,
    ...(workspaceWait === undefined ? {} : { workspaceWait }),
  };
}

function isRunStatus(input: unknown): input is AgentPlanRun["status"] {
  return (
    typeof input === "string" &&
    [
      "running",
      "pausing",
      "stopping",
      "succeeded",
      "failed",
      "cancelled",
      "paused",
      "work_done_closeout_open",
    ].includes(input)
  );
}

function readRunCommand(input: unknown): Pick<AgentPlanRun, "command"> {
  return input === undefined
    ? {}
    : { command: planRunCommandReceiptSchema.parse(input) };
}

function readClaudeUsage(input: unknown): Pick<AgentPlanRun, "claudeUsage"> {
  if (input === undefined) return {};
  if (input === null) return { claudeUsage: null };
  return { claudeUsage: claudeRunUsageSchema.parse(input) };
}
