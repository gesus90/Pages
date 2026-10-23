import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

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
  const canControl =
    plan.canEdit && run.userId === context.userId && !run.stopRequested;
  const issue = continuationIssue(plan, run);
  return {
    ...runControlMetadata(run),
    canPlay: plan.canEdit && !isActive && !context.hasReservation,
    canPause: canControl && run.status === "running",
    canResume: canControl && run.status === "paused" && !issue,
    canStop: canControl && isActive,
    canEdit: plan.canEdit,
    issue:
      run.userId === context.userId
        ? (issue ?? runFailure(run, context.hasReservation))
        : null,
  };
}

function runFailure(run: AgentPlanRun, hasReservation: boolean): string | null {
  if (run.controlError) return run.controlError;
  const failed = run.steps.find((step) => step.status === "failed");
  if (failed?.error) return failed.error;
  return hasReservation && !isActivePlanRun(run.status)
    ? "plan_closeout_failed"
    : null;
}

function runControlMetadata(
  run: AgentPlanRun,
): Pick<
  AgentPlanControl,
  | "runId"
  | "status"
  | "planRevision"
  | "continuationVersion"
  | "frontierStepIds"
> {
  return {
    runId: run.id,
    status: run.status,
    planRevision: run.continuation?.planRevision ?? run.planRevision,
    continuationVersion: run.continuation?.version ?? 0,
    frontierStepIds: run.pauseBoundary?.frontierStepIds ?? [],
  };
}
