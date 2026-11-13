import { planExecutionIssues } from "./AgentPlanGraph";
import { executablePlan } from "./AgentPlanStart";
import { expandPlanGroups } from "./AgentPlanGroup";
import { expandPlanLoops } from "./AgentPlanLoop";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentPlanInput } from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";

/** Advisory findings on active nodes; detached nodes get only a skipped-node warning. */
export function planWarnings(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentPlanIssue[] {
  const active = executablePlan(plan);
  const ids = new Set([
    ...active.nodes.map((node) => node.id),
    ...expandPlanLoops(expandPlanGroups(active)).nodes.map((node) => node.id),
  ]);
  const warnings = planExecutionIssues(active, agents).filter(
    (issue) => issue.nodeId !== null,
  );
  const all = [...plan.nodes, ...expandPlanLoops(expandPlanGroups(plan)).nodes];
  for (const node of all) {
    if (ids.has(node.id)) continue;
    warnings.push({ nodeId: node.id, port: null, reason: "unreachable" });
  }
  return [
    ...new Map(
      warnings.map((issue) => [JSON.stringify(issue), issue]),
    ).values(),
  ];
}
