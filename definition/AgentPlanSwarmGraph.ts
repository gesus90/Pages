import { PLAN_SWARM_SAVE_ISSUES, planSwarmIssues } from "./AgentPlanSwarm";

import type { AgentPlanInput } from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";
import type { AgentPlanSwarm } from "./AgentPlanSwarm";

/**
 * The plan issues of a swarm node (PAGE-313).
 *
 * @param node - The swarm.
 * @param plan - The plan whose execution target the node inherits.
 * @returns `swarmRemoteUnsupported` for a remote target, `swarmInvalid` for a
 * malformed setting and `swarmIncomplete` for a missing task or model; each
 * keeps the plan from starting.
 */
export function planSwarmGraphIssues(
  node: AgentPlanSwarm,
  plan: Pick<AgentPlanInput, "executionTarget">,
): readonly AgentPlanIssue[] {
  const issues = planSwarmIssues(node, plan);
  const reasons = new Set<AgentPlanIssue["reason"]>(
    issues.map((issue) => {
      if (issue === "swarm_remote_unsupported") return "swarmRemoteUnsupported";
      return PLAN_SWARM_SAVE_ISSUES.includes(issue)
        ? "swarmInvalid"
        : "swarmIncomplete";
    }),
  );
  return [...reasons].map((reason) => ({
    nodeId: node.id,
    port: null,
    reason,
  }));
}
