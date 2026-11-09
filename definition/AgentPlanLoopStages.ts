import { isPlanEventEdge } from "./AgentPlanBranching";
import { planLoopScopeEdges, planLoopScopeIds } from "./AgentPlanLoop";

import type { AgentPlanInput } from "./AgentPlan";
import type { AgentPlanLoop } from "./AgentPlanLoop";

/**
 * Groups the nodes of one loop iteration by their step along its flow edges.
 *
 * @param graph - The plan the run executes, its outer groups expanded.
 * @param loop - The loop.
 * @returns The node identifiers of each step, the first step of an iteration
 * first: its members and the stacks it triggers. Nodes on the same step sort
 * by identifier, as the outer flow does.
 */
export function planLoopStages(
  graph: Pick<AgentPlanInput, "nodes" | "edges">,
  loop: AgentPlanLoop,
): readonly (readonly string[])[] {
  const ids = planLoopScopeIds(graph, loop);
  const known = new Set(ids);
  const inner = planLoopScopeEdges(graph, loop).filter(
    (edge) =>
      known.has(edge.from) && known.has(edge.to) && !isPlanEventEdge(edge),
  );
  const depths = new Map(ids.map((id) => [id, 0]));
  // A loop's subgraph is acyclic, so as many passes as nodes settle every depth.
  for (let pass = 0; pass < ids.length; pass += 1)
    for (const edge of inner)
      depths.set(
        edge.to,
        Math.max(depths.get(edge.to) ?? 0, (depths.get(edge.from) ?? 0) + 1),
      );
  const stages = new Map<number, string[]>();
  for (const id of ids) {
    const depth = depths.get(id) ?? 0;
    stages.set(depth, [...(stages.get(depth) ?? []), id]);
  }
  return [...stages.keys()]
    .sort((first, second) => first - second)
    .map((depth) =>
      (stages.get(depth) ?? []).sort((first, second) =>
        first < second ? -1 : 1,
      ),
    );
}
