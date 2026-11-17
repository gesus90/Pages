import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isPlanWriterWaitActive } from "@/definition/AgentPlanRunState";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

/**
 * A run that waits for its workspace before any work: the one fact the panel
 * head and the status bar both name.
 * @remarks
 * Only the fact, its start and whether a step started are shown here. The
 * resource and the holder come from the server's own rights check.
 */
export interface PlanWorkspaceWait {
  /** When the wait began; `null` for a run that began waiting before the start was stored. */
  readonly since: string | null;
  /** Whether a step already started; `null` while the run's records are not shown. */
  readonly hasStartedStep: boolean | null;
}

const UNSTARTED_STATUSES: readonly AgentPlanStepResult["status"][] = [
  "waiting",
  "paused",
  "skipped",
];

/** A step started when its record says it ran or ended, not when it only waits or was cancelled before. */
function hasStartedStep(run: AgentPlanRun): boolean {
  return allPlanRunResults(run).some(
    (step) =>
      !UNSTARTED_STATUSES.includes(step.status) &&
      step.cancellation !== "not_started",
  );
}

/**
 * Derives the waiting state from the shown run, or from the plan control while
 * the reader's history does not show the run.
 * @param run - The run the canvas shows.
 * @param control - The control state, which every reader of the plan receives.
 * @returns The wait, or `null` while the run does not wait for its workspace.
 */
export function planWorkspaceWait(
  run: AgentPlanRun | null,
  control: AgentPlanControl | undefined,
): PlanWorkspaceWait | null {
  if (run)
    return isPlanWriterWaitActive(run)
      ? {
          since:
            run.workspaceWaitingSince ?? control?.workspaceWaitingSince ?? null,
          hasStartedStep: hasStartedStep(run),
        }
      : null;
  if (control?.status !== "running" || control.isWaitingForWorkspace !== true)
    return null;
  return { since: control.workspaceWaitingSince ?? null, hasStartedStep: null };
}
