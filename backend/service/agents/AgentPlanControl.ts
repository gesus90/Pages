import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { canRunPlan, isPlanAdministrator } from "@/definition/AgentPlanTeam";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import {
  isActivePlanRun,
  isPlanWriterWaitActive,
  isResumablePlanRunEnd,
} from "@/definition/AgentPlanRunState";

import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type {
  AgentPlanControl,
  AgentPlanResumeKind,
} from "@/definition/AgentPlanControl";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

function continuationIssue(
  plan: AgentPlanView,
  run: AgentPlanRun,
): string | null {
  if (run.status !== "paused") return null;
  if (!run.pauseBoundary) return "plan_run_unavailable";
  const nodes = expandPlanGroups(plan).nodes;
  return run.pauseBoundary.frontierStepIds.some(
    (id) => !nodes.some((node) => node.id === id),
  )
    ? "plan_continuation_deleted"
    : null;
}

function isBlockedByBusiness(step: AgentPlanStepResult): boolean {
  return step.status === "failed" && step.failureStop?.failureClass === "harm";
}

/**
 * The state "Fortsetzen" continues, which names the way the server takes.
 *
 * @remarks
 * A paused run continues at its pause point. Every ended, unfinished run
 * continues as a new linked run at its last safe state. Stopped is display-only.
 * The kind tells
 * the person why: a lost process (`interrupted`), a step that reported
 * `blocked`, an open closeout, an explicit stop, or a plain failure.
 */
export function planResumeKind(run: AgentPlanRun): AgentPlanResumeKind | null {
  if (run.status === "paused") return "paused";
  if (run.status === "work_done_closeout_open") return "closeout_open";
  if (run.status === "cancelled") return "stopped";
  if (run.status !== "failed") return null;
  if (run.stopRequested) return "stopped";
  if (run.recovery?.state === "interrupted") return "interrupted";
  return allPlanRunResults(run).some(isBlockedByBusiness)
    ? "blocked"
    : "failed";
}

/** Derives every action from durable state and current ownership; read-only never mutates. */
export function planControl(
  plan: AgentPlanView,
  run: AgentPlanRun | null,
  context: {
    readonly userId: string;
    readonly hasReservation: boolean;
  },
): AgentPlanControl {
  if (!run)
    return {
      runId: null,
      status: "idle",
      canPlay: canRunPlan(plan),
      canEdit: plan.canEdit,
      canPause: false,
      canResume: false,
      canStop: false,
      issue: null,
      planRevision: null,
      continuationVersion: 0,
      frontierStepIds: [],
    };
  const isActive = isActivePlanRun(run.status);
  // An administrator controls every run, also one somebody else started (PAGE-329).
  const canIdentify =
    canRunPlan(plan) &&
    (run.userId === context.userId || isPlanAdministrator(plan));
  const issue = continuationIssue(plan, run);
  return {
    ...runControlMetadata(run, canIdentify),
    canPlay: canRunPlan(plan) && (!isActive || canIdentify),
    workspaceWait:
      canIdentify && isPlanWriterWaitActive(run)
        ? run.workspaceWait
        : undefined,
    canRestart: canIdentify,
    ...ownRunActions(run, canIdentify, issue),
    canEdit: plan.canEdit,
    ...foreignRunBlocker(plan, run, canIdentify),
    issue: canIdentify
      ? (issue ?? runFailure(run, context.hasReservation))
      : null,
  };
}

/** What the executor of the run can do with it now; a run of someone else offers nothing. */
function ownRunActions(
  run: AgentPlanRun,
  canIdentify: boolean,
  issue: string | null,
): Pick<
  AgentPlanControl,
  "resumeAction" | "resumeKind" | "canPause" | "canResume" | "canStop"
> {
  const kind = planResumeKind(run);
  return {
    resumeAction: isEndedResumable(run) ? "recovery" : "paused",
    ...(canIdentify && kind ? { resumeKind: kind } : {}),
    canPause: canIdentify && !run.stopRequested && run.status === "running",
    canResume: canIdentify && resumableStatus(run, issue),
    canStop: canIdentify && isStoppable(run),
  };
}

/**
 * Names the run of another executor, which this reader may neither continue
 * nor take over; plan rights alone grant no control of it.
 */
function foreignRunBlocker(
  plan: AgentPlanView,
  run: AgentPlanRun,
  canIdentify: boolean,
): Pick<AgentPlanControl, "resumeBlocker"> {
  if (canIdentify || !canRunPlan(plan)) return {};
  return run.status === "paused" || isEndedResumable(run)
    ? { resumeBlocker: "own_run_required" }
    : {};
}

function runFailure(run: AgentPlanRun, hasReservation: boolean): string | null {
  if (isPlanWriterWaitActive(run)) return "plan_workspace_waiting";
  if (run.controlError) return run.controlError;
  const failed = run.steps.find((step) => step.status === "failed");
  if (failed?.error) return failed.error;
  return hasReservation && !isActivePlanRun(run.status)
    ? "plan_closeout_failed"
    : null;
}

function runControlMetadata(
  run: AgentPlanRun,
  canIdentify: boolean,
): Pick<
  AgentPlanControl,
  | "runId"
  | "status"
  | "planRevision"
  | "continuationVersion"
  | "frontierStepIds"
> {
  return {
    runId: canIdentify ? run.id : null,
    status: run.status,
    planRevision: canIdentify
      ? (run.continuation?.planRevision ?? run.planRevision)
      : null,
    continuationVersion: canIdentify ? (run.continuation?.version ?? 0) : 0,
    frontierStepIds: canIdentify
      ? (run.pauseBoundary?.frontierStepIds ?? [])
      : [],
  };
}

/** Ended runs that "Fortsetzen" continues: failures and open closeouts, except an explicit Stop. */
export function isEndedResumable(run: AgentPlanRun): boolean {
  return !run.stopRequested && isResumablePlanRunEnd(run.status);
}

/**
 * Stop reaches every run that is not finished, also one that already stops.
 *
 * @remarks
 * A run that ended at a failure still holds what it ran with, so Stop settles
 * it as cancelled; a run that already stops is ended by force on the second
 * Stop, also when a process hangs.
 */
function isStoppable(run: AgentPlanRun): boolean {
  return isActivePlanRun(run.status) || isResumablePlanRunEnd(run.status);
}

function resumableStatus(run: AgentPlanRun, issue: string | null): boolean {
  if (run.status === "paused") return !run.stopRequested && !issue;
  return isEndedResumable(run) && !issue;
}
