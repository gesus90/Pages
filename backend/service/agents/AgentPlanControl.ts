import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import {
  isActivePlanRun,
  isPlanWriterWaitActive,
} from "@/definition/AgentPlanRunState";

import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

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
      canPlay: plan.canEdit,
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
  const canIdentify = plan.canEdit && run.userId === context.userId;
  const canControl = canIdentify && !run.stopRequested;
  const issue = continuationIssue(plan, run);
  return {
    ...runControlMetadata(run, canIdentify),
    canPlay: plan.canEdit && (!isActive || canIdentify),
    workspaceWait:
      canIdentify && isPlanWriterWaitActive(run)
        ? run.workspaceWait
        : undefined,
    canRestart: canIdentify,
    resumeAction: run.status === "failed" ? "recovery" : "paused",
    canPause: canControl && run.status === "running",
    canResume: canControl && resumableStatus(run, issue),
    canStop: canControl && isActive,
    canEdit: plan.canEdit,
    issue: canIdentify
      ? (issue ?? runFailure(run, context.hasReservation))
      : null,
  };
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

function resumableStatus(run: AgentPlanRun, issue: string | null): boolean {
  return (run.status === "paused" || run.status === "failed") && !issue;
}
