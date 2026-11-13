import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { readAgentSwarmStep } from "@/definition/AgentPlanSwarmOperations";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { PlanBridgeGrant } from "./PlanBridgeGrants";

/**
 * Whether the grant belongs to the main model or a helper of a running swarm (PAGE-313).
 *
 * @remarks
 * The sessions of a swarm have no session record of their own; their grant
 * names the swarm node or `<node>::H<n>`. Whether the helper still works is
 * decided by the swarm itself, which refuses the tools of an ended helper.
 */
function isSwarmSession(
  result: AgentPlanStepResult,
  grant: PlanBridgeGrant,
): boolean {
  if (result.swarm === undefined) return false;
  return readAgentSwarmStep(grant.stepId).nodeId === result.id;
}

/**
 * Builds the activity check of the plan bridge from the stored runs.
 *
 * @param runs - The run records the API process reads.
 * @returns A check that admits a call only while the run runs or pauses and a
 * step that belongs to the grant's session is `running`; a finished, failed,
 * cancelled or not yet started step, a stopping run and an unknown run are
 * refused.
 *
 * @remarks
 * The step results are matched by the process instance of the session, which
 * members of a retained group share and which every attempt records before
 * its credential is issued. A group is therefore active exactly while one of
 * its members runs; between two members, while the group only waits, its
 * bearer admits nothing.
 */
export function planSessionActivity(
  runs: Pick<AgentPlanRunRepository, "find">,
): (grant: PlanBridgeGrant) => Promise<boolean> {
  return async (grant) => {
    const run = await runs.find(grant.runId);
    if (!run || run.stopRequested) return false;
    if (run.status !== "running" && run.status !== "pausing") return false;
    return allPlanRunResults(run).some(
      (result) =>
        result.status === "running" &&
        (result.session?.instanceId === grant.instanceId ||
          isSwarmSession(result, grant)),
    );
  };
}
