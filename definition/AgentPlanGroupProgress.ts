import type { AgentPlanRun, AgentPlanStepResult } from "./AgentPlan";
import type { AgentPlanGroup } from "./AgentPlanGroup";

/** Presentation states supplement the recorded step status with run control and access state. */
export type PlanGroupState =
  | "ready"
  | "running"
  | "pausing"
  | "paused"
  | "stopping"
  | "stopped"
  | "completed"
  | "blocked"
  | "failed"
  | "unavailable";

/** Counts only successful agent turns in the selected run, never the derived frame result. */
export interface PlanGroupProgress {
  readonly completed: number;
  readonly total: number | null;
  readonly state: PlanGroupState;
  readonly error: string | null;
}

/** The frozen run membership takes precedence over the editor's current revision. */
export function planGroupRunMembers(
  group: AgentPlanGroup,
  run: AgentPlanRun,
): readonly AgentPlanStepResult[] {
  const linked = run.steps.filter((step) => step.groupId === group.id);
  if (linked.length > 0) return linked;
  return run.steps.filter((step) =>
    group.steps.some((member) => member.id === step.id),
  );
}

function hasLostGroupSession(members: readonly AgentPlanStepResult[]): boolean {
  return (
    members.some((step) =>
      step.session?.events.some((event) =>
        event.startsWith("resource session retired:"),
      ),
    ) && members.some((step) => step.status !== "succeeded")
  );
}

function groupControlState(
  run: AgentPlanRun,
  members: readonly AgentPlanStepResult[],
): PlanGroupState {
  if (run.status === "stopping") return "stopping";
  if (run.status === "pausing") return "pausing";
  if (
    run.status === "cancelled" ||
    members.some((step) => step.status === "cancelled")
  )
    return "stopped";
  if (run.status === "failed") return "blocked";
  if (run.status === "paused") return "paused";
  if (members.some((step) => step.status === "running")) return "running";
  if (members.some((step) => step.status === "paused")) return "paused";
  return "ready";
}

function isStoppedRun(run: AgentPlanRun | null): boolean {
  return (
    run?.stopRequested === true ||
    run?.status === "stopping" ||
    run?.status === "cancelled"
  );
}

function groupState(
  run: AgentPlanRun,
  members: readonly AgentPlanStepResult[],
): PlanGroupState {
  if (members.length === 0) return "unavailable";
  if (
    members.some(
      (step) =>
        step.status === "failed" ||
        step.session?.closeout === "failed" ||
        (step.status === "succeeded" && step.session?.resultCode === -1),
    )
  )
    return "failed";
  if (
    members.some((step) => step.isBlocked) ||
    (hasLostGroupSession(members) && !isStoppedRun(run))
  )
    return "blocked";
  if (members.every((step) => step.status === "succeeded")) return "completed";
  if (run.controlError) return "blocked";
  if (
    members.every(
      (step) => step.status === "succeeded" || step.status === "cancelled",
    )
  )
    return "stopped";
  return groupControlState(run, members);
}

function groupError(
  members: readonly AgentPlanStepResult[],
  error: string | null,
  run: AgentPlanRun | null,
): string | null {
  if (error) return error;
  const failure = members.find((step) => step.error);
  if (failure?.error) return failure.error;
  return !isStoppedRun(run) && hasLostGroupSession(members)
    ? "plan_group_session_lost"
    : null;
}

/**
 * Derives a frame's status and progress without adding an execution step.
 *
 * @remarks
 * Failures and blocked inputs win over activity. Control states apply only
 * to unfinished groups. A terminal run cannot leave a group Running.
 * This scheduler has a finite DAG and one result per agent; missing or
 * duplicate run membership is unknown rather than an invented iteration total.
 */
export function planGroupProgress(
  group: AgentPlanGroup,
  run: AgentPlanRun | null,
  error: string | null = null,
): PlanGroupProgress {
  const members = run ? planGroupRunMembers(group, run) : [];
  const hasKnownTotal =
    !run ||
    (members.length > 0 &&
      new Set(members.map((step) => step.id)).size === members.length);
  let total: number | null = null;
  if (!error && hasKnownTotal)
    total = run ? members.length : group.steps.length;
  let state: PlanGroupState = "ready";
  if (run) state = groupState(run, members);
  if (error || !hasKnownTotal) state = "unavailable";
  return {
    completed: error
      ? 0
      : members.filter(
          (step) =>
            step.status === "succeeded" &&
            step.session?.closeout !== "failed" &&
            step.session?.resultCode !== -1,
        ).length,
    total,
    state,
    error: groupError(members, error, run),
  };
}
