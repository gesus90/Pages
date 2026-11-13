import { expandPlanGroups } from "./AgentPlanGroup";
import {
  planLoopDecisions,
  planLoopMembers,
  planLoopEdges,
  planLoopGroups,
} from "./AgentPlanLoop";

import type { AgentPlanInput, AgentPlanNode } from "./AgentPlan";
import type { AgentPlanLoop } from "./AgentPlanLoop";

interface ContinuationNode {
  readonly id: string;
  readonly type: string;
  readonly members?: readonly Pick<AgentPlanNode, "id" | "type">[];
  readonly edges?: AgentPlanLoop["edges"];
}

/** Execution identity and edges, excluding input values that pending steps may correct. */
export function planContinuationGraph(plan: AgentPlanInput): string {
  const flat = expandPlanGroups(plan);
  const nodes = flat.nodes.filter(
    (node) => !["task", "parameter", "variable", "asset"].includes(node.type),
  );
  return JSON.stringify({
    nodes: nodes
      .map(nodeShape)
      .sort((first, second) => first.id.localeCompare(second.id)),
    edges: [...flat.edges].sort((first, second) =>
      JSON.stringify(first).localeCompare(JSON.stringify(second)),
    ),
  });
}

function nodeShape(node: AgentPlanNode): ContinuationNode {
  if (node.type !== "loop") return { id: node.id, type: node.type };
  return {
    id: node.id,
    type: node.type,
    members: [...planLoopMembers(node), ...planLoopDecisions(node)].map(
      (member) => ({ id: member.id, type: member.type }),
    ),
    edges: node.edges,
  };
}

/** Keeps a started loop's count, conditions, membership and order while permitting input repairs. */
export function planLoopContinuationShape(loop: AgentPlanLoop): string {
  return JSON.stringify({
    ...loop,
    steps: planLoopMembers(loop).map((step) => ({
      id: step.id,
      type: step.type,
    })),
    edges: planLoopEdges(loop),
    groups: planLoopGroups(loop).map((group) => ({
      id: group.id,
      members: group.steps.map((step) => step.id),
    })),
    decisions: planLoopDecisions(loop),
  });
}
