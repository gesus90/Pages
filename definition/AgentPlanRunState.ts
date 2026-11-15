import { allPlanRunResults } from "./AgentPlanLoopResults";

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

/**
 * These states execute steps, so the plan cannot be edited until the run is paused or has ended.
 *
 * @remarks
 * A paused run may retain a suspended native turn; that turn resumes with its
 * original snapshot, while a drained run may adopt a saved revision.
 */
export function isPlanEditLocked(
  status: AgentPlanRun["status"] | "idle",
): status is "running" | "pausing" | "stopping" {
  return status === "running" || status === "pausing" || status === "stopping";
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

/** Identifies the Codex control contract from the immutable execution facts, including loop members. */
export function isCodexPlanRun(run: AgentPlanRun): boolean {
  return allPlanRunResults(run).some(
    (step) =>
      step.session?.runner === "codex_cli" ||
      step.execution?.modelAccess.provider === "codex_cli",
  );
}
