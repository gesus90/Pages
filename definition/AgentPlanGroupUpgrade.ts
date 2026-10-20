import {
  planGroupEntries,
  planGroupExits,
  resolvePlanGroupBinding,
} from "./AgentPlanGroup";
import {
  withExplicitGroupFlow,
  withInternalGroupEdges,
} from "./AgentPlanGroupEdit";

import type { AgentPlanInput } from "./AgentPlan";

/**
 * Resolves unambiguous legacy frame connections to real agent endpoints.
 *
 * @remarks
 * This is an idempotent read/write upgrade of the existing JSON contract, not
 * a schema change. Original boundary definitions remain readable as legacy
 * metadata. An ambiguous frame edge or alias stays intact for validation and
 * explicit repair; no Cartesian fan-out or guessed dependency is introduced.
 * Run snapshots are never rewritten.
 */
export function withPortlessPlanGroups<Plan extends AgentPlanInput>(
  input: Plan,
): Plan {
  const plan = withExplicitGroupFlow(input);
  const groups = plan.nodes.filter((node) => node.type === "group");
  function endpoint(id: string, side: "from" | "to"): string {
    const group = groups.find((entry) => entry.id === id);
    if (!group) return id;
    const candidates =
      side === "from" ? planGroupExits(group) : planGroupEntries(group);
    return candidates.length === 1 ? (candidates[0]?.id ?? id) : id;
  }
  return withInternalGroupEdges({
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.type !== "group"
        ? node
        : {
            ...node,
            steps: node.steps.map((step) => ({
              ...step,
              bindings: Object.fromEntries(
                Object.entries(step.bindings).map(([name, binding]) => [
                  name,
                  resolvePlanGroupBinding(binding, node, plan),
                ]),
              ),
            })),
          },
    ),
    edges: plan.edges.map((edge) => ({
      ...edge,
      from: endpoint(edge.from, "from"),
      to: endpoint(edge.to, "to"),
    })),
  });
}
