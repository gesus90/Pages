import { planGroupEdges, planGroupRefusal } from "./AgentPlanGroup";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanGroup, AgentPlanGroupRefusal } from "./AgentPlanGroup";

/** Grid columns between members when an older group is laid out in its frame. */
const MEMBER_COLUMN = 320;

/** An agent node and the group it belongs to; `null` for a node outside every frame. */
export interface PlanStepLocation {
  readonly step: AgentPlanStep;
  readonly group: AgentPlanGroup | null;
}

/**
 * A plan after an agent node crossed a frame, with what it had to give up.
 *
 * @remarks
 * Flow edges never cross a frame, and boundary ports belong to their frame, so
 * a node that crosses one loses those connections. Callers name the counts to
 * the person instead of removing them silently.
 */
export interface PlanGroupMove<Plan extends AgentPlanInput> {
  readonly plan: Plan;
  /** Flow edges of the node on the side it left. */
  readonly removedEdges: number;
  /** Inputs that were bound to ports of the frame it left. */
  readonly removedBindings: number;
}

/** Where an agent node is placed: in a group's member area or outside every frame. */
export interface PlanStepPlacement {
  readonly stepId: string;
  /** `null` places the node outside every frame. */
  readonly groupId: string | null;
  /** Relative to the member area inside a group, absolute outside. */
  readonly position: AgentPlanPosition;
}

/** Finds an agent node outside or inside a frame. */
export function findPlanStep(
  plan: AgentPlanInput,
  id: string,
): PlanStepLocation | null {
  for (const node of plan.nodes) {
    if (node.type === "agent" && node.id === id)
      return { step: node, group: null };
    if (node.type !== "group") continue;
    const step = node.steps.find((entry) => entry.id === id);
    if (step) return { step, group: node };
  }
  return null;
}

/** Replaces a node by its identifier, also an agent inside a frame. */
export function replacePlanNode<Plan extends AgentPlanInput>(
  plan: Plan,
  replacement: AgentPlanNode,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.id === replacement.id) return replacement;
      if (node.type !== "group" || replacement.type !== "agent") return node;
      return node.steps.some((step) => step.id === replacement.id)
        ? {
            ...node,
            steps: node.steps.map((step) =>
              step.id === replacement.id ? replacement : step,
            ),
          }
        : node;
    }),
  };
}

function withoutPorts(
  step: AgentPlanStep,
  group: AgentPlanGroup,
): { readonly step: AgentPlanStep; readonly removed: number } {
  const ports = new Set(group.parameters.map((port) => port.id));
  const kept = Object.entries(step.bindings).filter(
    ([, binding]) => !(binding.kind === "source" && ports.has(binding.nodeId)),
  );
  return {
    step: { ...step, bindings: Object.fromEntries(kept) },
    removed: Object.keys(step.bindings).length - kept.length,
  };
}

function touches(edge: AgentPlanEdge, id: string): boolean {
  return edge.from === id || edge.to === id;
}

/**
 * Moves an agent node into a group, within it, or out of every frame.
 *
 * @returns The changed plan, or why the target group refuses the node; the
 * node is then left exactly as it was, never reconfigured to fit.
 */
export function placePlanStep<Plan extends AgentPlanInput>(
  plan: Plan,
  placement: PlanStepPlacement,
  agents: readonly AgentDefinitionChoice[],
): PlanGroupMove<Plan> | AgentPlanGroupRefusal {
  const found = findPlanStep(plan, placement.stepId);
  if (!found) return "missingAgent";
  const target = plan.nodes.find(
    (node): node is AgentPlanGroup =>
      node.type === "group" && node.id === placement.groupId,
  );
  if (placement.groupId !== null && !target) return "missingAgent";
  const moved = { ...found.step, ...placement.position };
  if ((found.group?.id ?? null) === placement.groupId)
    return {
      plan: replacePlanNode(plan, moved),
      removedEdges: 0,
      removedBindings: 0,
    };
  const refusal = target ? planGroupRefusal(target, moved, agents) : null;
  if (refusal !== null) return refusal;
  const left = leave(plan, found, moved);
  const nodes = target
    ? left.plan.nodes.map((node) =>
        node.id === target.id && node.type === "group"
          ? {
              ...node,
              steps: [...node.steps, left.step],
              edges: planGroupEdges(node),
            }
          : node,
      )
    : [...left.plan.nodes, left.step];
  return {
    plan: { ...left.plan, nodes },
    removedEdges: left.removedEdges,
    removedBindings: left.removedBindings,
  };
}

/** Takes the node out of its frame or out of the outer graph, with the connections of that side. */
function leave<Plan extends AgentPlanInput>(
  plan: Plan,
  found: PlanStepLocation,
  moved: AgentPlanStep,
): PlanGroupMove<Plan> & { readonly step: AgentPlanStep } {
  const { group } = found;
  if (!group) {
    const edges = plan.edges.filter((edge) => !touches(edge, moved.id));
    return {
      plan: {
        ...plan,
        nodes: plan.nodes.filter((node) => node.id !== moved.id),
        edges,
      },
      step: moved,
      removedEdges: plan.edges.length - edges.length,
      removedBindings: 0,
    };
  }
  const internal = planGroupEdges(group);
  const edges = internal.filter((edge) => !touches(edge, moved.id));
  const detached = withoutPorts(moved, group);
  const nodes = plan.nodes.map((node) =>
    node.id === group.id
      ? {
          ...group,
          steps: group.steps.filter((step) => step.id !== moved.id),
          edges,
        }
      : node,
  );
  return {
    plan: { ...plan, nodes },
    step: detached.step,
    removedEdges: internal.length - edges.length,
    removedBindings: detached.removed,
  };
}

/**
 * Removes a frame and keeps its members as nodes of the outer graph.
 *
 * @param plan - The plan with the frame.
 * @param groupId - The frame to remove.
 * @param positionOf - The absolute grid position of a member, so it stays
 * where the frame showed it.
 * @returns The plan; the internal edges become outer edges, while the edges
 * at the frame and the bindings to its ports go with it and are counted.
 */
export function ungroupPlanGroup<Plan extends AgentPlanInput>(
  plan: Plan,
  groupId: string,
  positionOf: (step: AgentPlanStep) => AgentPlanPosition,
): PlanGroupMove<Plan> {
  const group = plan.nodes.find(
    (node): node is AgentPlanGroup =>
      node.type === "group" && node.id === groupId,
  );
  if (!group) return { plan, removedEdges: 0, removedBindings: 0 };
  let removedBindings = 0;
  const members = group.steps.map((step) => {
    const detached = withoutPorts(step, group);
    removedBindings += detached.removed;
    return { ...detached.step, ...positionOf(step) };
  });
  const edges = plan.edges.filter((edge) => !touches(edge, groupId));
  return {
    plan: {
      ...plan,
      nodes: [...plan.nodes.filter((node) => node.id !== groupId), ...members],
      edges: [...edges, ...planGroupEdges(group)],
    },
    removedEdges: plan.edges.length - edges.length,
    removedBindings,
  };
}

/**
 * Adds a flow edge between two nodes of the same level: outside every frame or inside one.
 *
 * @returns The plan, or `groupBoundary` when the edge would cross a frame,
 * which only the frame's own flow ports may do.
 */
export function connectPlanFlow<Plan extends AgentPlanInput>(
  plan: Plan,
  from: string,
  to: string,
): Plan | "groupBoundary" {
  const source = findPlanStep(plan, from)?.group ?? null;
  const target = findPlanStep(plan, to)?.group ?? null;
  if (source?.id !== target?.id) return "groupBoundary";
  const edge = { from, to, fromPort: "flow-out", toPort: "flow-in" };
  if (!source) return { ...plan, edges: [...plan.edges, edge] };
  return replacePlanNode(plan, {
    ...source,
    edges: [...planGroupEdges(source), edge],
  });
}

/** Removes one internal flow edge of a group and keeps both members. */
export function disconnectPlanGroupFlow<Plan extends AgentPlanInput>(
  plan: Plan,
  groupId: string,
  link: Pick<AgentPlanEdge, "from" | "to">,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.type === "group" && node.id === groupId
        ? {
            ...node,
            edges: planGroupEdges(node).filter(
              (edge) => edge.from !== link.from || edge.to !== link.to,
            ),
          }
        : node,
    ),
  };
}

/**
 * Gives every group saved before internal edges existed its explicit edges and a member layout.
 *
 * @remarks
 * Such a group ran its members in their stored order; that order becomes the
 * chain of edges, so the group runs exactly as before. Its members never had
 * a place of their own on the grid, so they are laid out in one row of the
 * frame. Groups with edges stay as they are.
 */
export function withExplicitGroupFlow<Plan extends AgentPlanInput>(
  plan: Plan,
): Plan {
  if (!plan.nodes.some((node) => node.type === "group" && !node.edges))
    return plan;
  return {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.type === "group" && !node.edges
        ? {
            ...node,
            edges: planGroupEdges(node),
            steps: node.steps.map((step, index) => ({
              ...step,
              x: index * MEMBER_COLUMN,
              y: 0,
            })),
          }
        : node,
    ),
  };
}

/** Binds an input of an agent node, also of one inside a frame. */
export function bindPlanParameter<Plan extends AgentPlanInput>(
  plan: Plan,
  targetId: string,
  parameter: string,
  binding: AgentPlanBinding,
): Plan {
  const target =
    findPlanStep(plan, targetId)?.step ??
    plan.nodes.find(
      (node): node is AgentPlanGroup =>
        node.type === "group" && node.id === targetId,
    );
  if (!target) return plan;
  return replacePlanNode(plan, {
    ...target,
    bindings: { ...target.bindings, [parameter]: binding },
  });
}
