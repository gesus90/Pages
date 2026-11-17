import { planExecutionIssues } from "./AgentPlanGraph";
import { executablePlan } from "./AgentPlanStart";
import { expandPlanGroups } from "./AgentPlanGroup";
import { expandPlanLoops } from "./AgentPlanLoop";
import { isPlanJumpIn } from "./AgentPlanJump";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentPlanInput } from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";

/**
 * Advisory findings on active nodes; detached nodes get only a skipped-node warning.
 * @remarks
 * A run begins at a start, or at the receiving Jump a call names, so every
 * released receiving Jump is checked as the run of its own entry, and what
 * lies behind it counts as reached.
 */
export function planWarnings(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentPlanIssue[] {
  const entries = plan.nodes
    .filter(isPlanJumpIn)
    .filter((node) => node.isEnabled)
    .map((node) => executablePlan(plan, node.id));
  const ids = new Set<string>();
  const warnings: AgentPlanIssue[] = [];
  for (const active of [executablePlan(plan), ...entries]) {
    for (const node of [
      ...active.nodes,
      ...expandPlanLoops(expandPlanGroups(active)).nodes,
    ])
      ids.add(node.id);
    warnings.push(
      ...planExecutionIssues(active, agents).filter(
        (issue) => issue.nodeId !== null,
      ),
    );
  }
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
