import type { AgentPlanRun } from "./AgentPlan";

/** These states retain ownership of the plan until execution and cleanup have settled. */
export function isActivePlanRun(
  status: AgentPlanRun["status"],
): status is "running" | "pausing" | "paused" | "stopping" {
  return (
    status === "running" ||
    status === "pausing" ||
    status === "paused" ||
    status === "stopping"
  );
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
