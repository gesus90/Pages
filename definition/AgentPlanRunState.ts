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
