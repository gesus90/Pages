import {
  planGroupEdges,
  planGroupRefusal,
  planGroupEntries,
  planGroupExits,
  resolvePlanGroupBinding,
} from "./AgentPlanGroup";

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
import type { AgentPlanScript } from "./AgentPlanScript";

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
 * Membership changes preserve connections; legacy aliases are resolved before
 * detaching. The counters remain for callers of the established edit API.
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

/**
 * Finds the node whose inputs a binding fills: an agent, also inside a
 * frame, a script, or a frame with its retained legacy inputs.
 */
export function findPlanBindingTarget(
  plan: AgentPlanInput,
  id: string,
): AgentPlanStep | AgentPlanScript | AgentPlanGroup | null {
  return (
    findPlanStep(plan, id)?.step ??
    plan.nodes.find(
      (node): node is AgentPlanScript | AgentPlanGroup =>
        (node.type === "script" || node.type === "group") && node.id === id,
    ) ??
    null
  );
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

function withResolvedBindings(
  step: AgentPlanStep,
  group: AgentPlanGroup,
  plan: AgentPlanInput,
): AgentPlanStep {
  return {
    ...step,
    bindings: Object.fromEntries(
      Object.entries(step.bindings).map(([name, binding]) => [
        name,
        resolvePlanGroupBinding(binding, group, plan),
      ]),
    ),
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
      plan: withInternalGroupEdges(replacePlanNode(plan, moved)),
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
    plan: withInternalGroupEdges({ ...left.plan, nodes }),
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
  if (!group)
    return {
      plan: {
        ...plan,
        nodes: plan.nodes.filter((node) => node.id !== moved.id),
      },
      step: moved,
      removedEdges: 0,
      removedBindings: 0,
    };
  const internal = planGroupEdges(group);
  const edges = internal.filter((edge) => !touches(edge, moved.id));
  const detached = withResolvedBindings(moved, group, plan);
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
    plan: {
      ...plan,
      nodes,
      edges: [
        ...plan.edges,
        ...internal.filter((edge) => touches(edge, moved.id)),
      ],
    },
    step: detached,
    removedEdges: 0,
    removedBindings: 0,
  };
}

/**
 * Removes a frame and keeps its members as nodes of the outer graph.
 *
 * @param plan - The plan with the frame.
 * @param groupId - The frame to remove.
 * @param positionOf - The absolute grid position of a member, so it stays
 * where the frame showed it.
 * @returns Members with direct bindings and all explicit edges. Ambiguous legacy
 * connections leave the plan intact until the caller repairs them.
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
  const members = group.steps.map((step) => ({
    ...withResolvedBindings(step, group, plan),
    ...positionOf(step),
  }));
  // Unresolved aliases and ambiguous frame edges need explicit repair first.
  if (
    members.some((step) =>
      Object.values(step.bindings).some(
        (binding) =>
          binding.kind === "source" &&
          group.parameters.some((port) => port.id === binding.nodeId),
      ),
    )
  )
    return { plan, removedEdges: 0, removedBindings: 0 };
  const entries = planGroupEntries(group);
  const exits = planGroupExits(group);
  if (
    plan.edges.some(
      (edge) =>
        (edge.to === groupId && entries.length !== 1) ||
        (edge.from === groupId && exits.length !== 1),
    )
  )
    return { plan, removedEdges: 0, removedBindings: 0 };
  const edges = plan.edges.map((edge) => ({
    ...edge,
    from: edge.from === groupId ? (exits[0]?.id ?? edge.from) : edge.from,
    to: edge.to === groupId ? (entries[0]?.id ?? edge.to) : edge.to,
  }));
  return {
    plan: {
      ...plan,
      nodes: [...plan.nodes.filter((node) => node.id !== groupId), ...members],
      edges: [...edges, ...planGroupEdges(group)],
    },
    removedEdges: 0,
    removedBindings: 0,
  };
}

/**
 * Adds an explicit edge between actual agents or checkpoints, across frames too.
 *
 * @returns The plan, or `groupBoundary` when an endpoint names a frame.
 */
export function connectPlanFlow<Plan extends AgentPlanInput>(
  plan: Plan,
  from: string,
  to: string,
): Plan | "groupBoundary" {
  const source = findPlanStep(plan, from)?.group ?? null;
  const target = findPlanStep(plan, to)?.group ?? null;
  if (
    plan.nodes.some(
      (node) => node.type === "group" && (node.id === from || node.id === to),
    )
  )
    return "groupBoundary";
  const edge = { from, to, fromPort: "flow-out", toPort: "flow-in" };
  if (!source || source.id !== target?.id)
    return { ...plan, edges: [...plan.edges, edge] };
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

/** Binds an input of an agent node, also of one inside a frame, or of a script. */
export function bindPlanParameter<Plan extends AgentPlanInput>(
  plan: Plan,
  targetId: string,
  parameter: string,
  binding: AgentPlanBinding,
): Plan {
  const target = findPlanBindingTarget(plan, targetId);
  if (!target) return plan;
  return replacePlanNode(plan, {
    ...target,
    bindings: { ...target.bindings, [parameter]: binding },
  });
}

/** Keeps edges between members in their container, including after reparenting, so group templates retain every internal connection. */
export function withInternalGroupEdges<Plan extends AgentPlanInput>(
  plan: Plan,
): Plan {
  const groups = plan.nodes.filter((node) => node.type === "group");
  const internal = new Set(
    plan.edges.filter((edge) =>
      groups.some((group) => isMemberEdge(group, edge)),
    ),
  );
  if (internal.size === 0) return plan;
  return {
    ...plan,
    edges: plan.edges.filter((edge) => !internal.has(edge)),
    nodes: plan.nodes.map((node) =>
      node.type === "group"
        ? {
            ...node,
            edges: [
              ...planGroupEdges(node),
              ...[...internal].filter((edge) => isMemberEdge(node, edge)),
            ],
          }
        : node,
    ),
  };
}

function isMemberEdge(group: AgentPlanGroup, edge: AgentPlanEdge): boolean {
  return (
    group.steps.some((step) => step.id === edge.from) &&
    group.steps.some((step) => step.id === edge.to)
  );
}
