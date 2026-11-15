import { planLoopMembers } from "./AgentPlanLoop";
import { planGroupEdges, planGroupRefusal } from "./AgentPlanGroup";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanGroup, AgentPlanGroupRefusal } from "./AgentPlanGroup";
import type { AgentPlanLoop } from "./AgentPlanLoop";
import type { PlanGroupMove } from "./AgentPlanGroupEdit";

/** Direct members of a session group; a loop keeps its iteration boundary. */
export function planGroupContent(
  group: AgentPlanGroup,
): readonly (AgentPlanStep | AgentPlanLoop)[] {
  return [...group.steps, ...(group.loops ?? [])];
}

/** Every agent that shares the group's session, including agents of its loops. */
export function planGroupAgents(
  group: AgentPlanGroup,
): readonly AgentPlanStep[] {
  return [
    ...group.steps,
    ...(group.loops ?? []).flatMap((loop) =>
      planLoopMembers(loop).filter((member) => member.type === "agent"),
    ),
  ];
}

/** All loops, including those owned by an outer group. */
export function allPlanLoops(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly AgentPlanLoop[] {
  return plan.nodes.flatMap((node) => {
    if (node.type === "loop") return [node];
    return node.type === "group" ? (node.loops ?? []) : [];
  });
}

/** The outer group that owns a loop and its session. */
export function planLoopOwner(
  plan: Pick<AgentPlanInput, "nodes">,
  loopId: string,
): AgentPlanGroup | undefined {
  return plan.nodes.find(
    (node): node is AgentPlanGroup =>
      node.type === "group" &&
      node.loops?.some((loop) => loop.id === loopId) === true,
  );
}

/** Changes loops without changing their owner or stored member coordinates. */
export function mapPlanLoops<Plan extends AgentPlanInput>(
  plan: Plan,
  transform: (loop: AgentPlanLoop) => AgentPlanLoop,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.type === "loop") return transform(node);
      return node.type === "group" && node.loops
        ? { ...node, loops: node.loops.map(transform) }
        : node;
    }),
  };
}

/** Finds every editor node without flattening saved container boundaries. */
export function planContainedNodes(
  plan: Pick<AgentPlanInput, "nodes">,
): readonly AgentPlanNode[] {
  function descendants(node: AgentPlanNode): readonly AgentPlanNode[] {
    if (node.type !== "group" && node.type !== "loop") return [node];
    const members = node.type === "group" ? planGroupContent(node) : node.steps;
    return [node, ...members.flatMap(descendants), ...(node.decisions ?? [])];
  }
  return plan.nodes.flatMap(descendants);
}

/** Moves a whole loop across a group boundary, preserving all edges and bindings. */
export function placePlanLoopInGroup<Plan extends AgentPlanInput>(
  plan: Plan,
  placement: {
    readonly loopId: string;
    readonly groupId: string | null;
    readonly position: AgentPlanPosition;
  },
  agents: readonly AgentDefinitionChoice[],
): PlanGroupMove<Plan> | AgentPlanGroupRefusal {
  const loop = allPlanLoops(plan).find(
    (entry) => entry.id === placement.loopId,
  );
  const owner = planLoopOwner(plan, placement.loopId);
  const target = plan.nodes.find(
    (node): node is AgentPlanGroup =>
      node.type === "group" && node.id === placement.groupId,
  );
  if (!loop || (placement.groupId !== null && !target)) return "missingAgent";
  const refusal = target ? loopGroupRefusal(target, loop, agents) : null;
  if (refusal) return refusal;
  const moved = { ...loop, ...placement.position };
  const leaving = owner
    ? planGroupEdges(owner).filter(
        (edge) => edge.from === loop.id || edge.to === loop.id,
      )
    : [];
  const edges = [...plan.edges, ...leaving];
  const nodes = plan.nodes
    .filter((node) => node.id !== loop.id)
    .map((node) => {
      if (node.type !== "group") return node;
      const loops = (node.loops ?? []).filter((entry) => entry.id !== loop.id);
      if (node.id === target?.id) loops.push(moved);
      if (node.id !== owner?.id && node.id !== target?.id) return node;
      return {
        ...node,
        loops,
        edges: planGroupEdges(node).filter((edge) => !leaving.includes(edge)),
      };
    });
  if (!target) nodes.push(moved);
  return {
    plan: { ...plan, nodes, edges },
    removedEdges: 0,
    removedBindings: 0,
  };
}

/** Rejects unsupported nesting and checks every agent without changing its provider. */
function loopGroupRefusal(
  group: AgentPlanGroup,
  loop: AgentPlanLoop,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanGroupRefusal | null {
  if (loop.steps.some((member) => member.type === "group"))
    return "nestedGroup";
  const combined = { ...group, steps: planGroupAgents(group), loops: [] };
  for (const member of planLoopMembers(loop)) {
    if (member.type !== "agent") continue;
    const refusal = planGroupRefusal(combined, member, agents);
    if (refusal) return refusal;
    combined.steps = [...combined.steps, member];
  }
  return null;
}
