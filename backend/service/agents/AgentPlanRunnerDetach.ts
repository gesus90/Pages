import { LOCAL_RUNNER_CONNECTION_ID } from "@/backend/service/runner/LocalRunnerIdentity";

import type { ActivePlanRun } from "./AgentPlanRunState";

/** Ends only the Pages observer during shutdown; the durable worker and its access remain. */
export class AgentPlanRunnerDetachedError extends Error {}

/** A runner-owned frontier can be adopted without terminating any directly owned process. */
export function canDetachLocalRunnerRun(active: ActivePlanRun): boolean {
  if (active.snapshot.runnerProtocolVersion === 1) return true;
  const runnerSteps = new Set(
    active.snapshot.remoteSteps
      ?.filter(
        (entry) => entry.target.connectionId === LOCAL_RUNNER_CONNECTION_ID,
      )
      .map((entry) => entry.step.id),
  );
  return (
    runnerSteps.size > 0 &&
    [...active.controllers.keys()].every((id) => runnerSteps.has(id))
  );
}
