import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { LocalSessionLaunch } from "./LocalSessionContracts";

/** Keeps native work bound to a live run and its exact durable attempt, including loop members. */
export function canContinueLocalTurn(
  run: AgentPlanRun | null,
  launch: LocalSessionLaunch,
): boolean {
  if (
    !run ||
    run.stopRequested ||
    !["running", "pausing", "paused"].includes(run.status)
  )
    return false;
  const step = allPlanRunResults(run).find(
    (candidate) =>
      candidate.id === launch.stepId &&
      candidate.session?.attemptId === launch.attemptId &&
      candidate.session.instanceId === launch.instanceId,
  );
  return (
    step !== undefined &&
    step.status !== "failed" &&
    step.status !== "cancelled" &&
    step.session?.closeout !== "failed" &&
    step.session?.closeout !== "confirmed"
  );
}
