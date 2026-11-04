import type { AgentPlanRun } from "./AgentPlan";

/** These states retain ownership of the plan until execution and cleanup have settled. */
export function isActivePlanRun(
  status: AgentPlanRun["status"] | "idle",
): status is "running" | "pausing" | "paused" | "stopping" {
  return (
    status === "running" ||
    status === "pausing" ||
    status === "paused" ||
    status === "stopping"
  );
}

/** These ended states have failed work or an open closeout, which the resume of the run continues. */
export function isResumablePlanRunEnd(
  status: AgentPlanRun["status"] | "idle",
): status is "failed" | "work_done_closeout_open" {
  return status === "failed" || status === "work_done_closeout_open";
}

/** A writer wait describes pending dispatch, never a paused, stopped or terminal run. */
export function isPlanWriterWaitActive(
  run: Pick<AgentPlanRun, "status" | "stopRequested" | "isWaitingForWorkspace">,
): boolean {
  return (
    run.status === "running" &&
    !run.stopRequested &&
    run.isWaitingForWorkspace === true
  );
}
