import { planEdgeKind } from "./AgentPlanBranching";
import { planGroupEdges } from "./AgentPlanGroup";
import {
  planLoopDecisions,
  planLoopGroups,
  planLoopMembers,
} from "./AgentPlanLoop";

import type {
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
} from "./AgentPlan";

/** Where a decision stands: at the top level, in a group or in a loop (PAGE-286). */
export type PlanDecisionPlace =
  | { readonly kind: "top" }
  | { readonly kind: "group"; readonly groupId: string }
  | { readonly kind: "loop"; readonly loopId: string };

/**
 * Finds a decision wherever it stands.
 *
 * @param plan - The saved plan with its groups and loops.
 * @param id - The decision.
 * @returns The decision and its place, or `null` when no decision has the id.
 * A decision in a group inside a loop belongs to the loop.
 */
export function findPlanDecision(
  plan: Pick<AgentPlanInput, "nodes">,
  id: string,
): {
  readonly decision: AgentPlanDecision;
  readonly place: PlanDecisionPlace;
} | null {
  for (const node of plan.nodes) {
    if (node.type === "decision" && node.id === id)
      return { decision: node, place: { kind: "top" } };
    if (node.type === "group") {
      const decision = node.decisions?.find((entry) => entry.id === id);
      if (decision)
        return { decision, place: { kind: "group", groupId: node.id } };
    }
    if (node.type !== "loop") continue;
    const decision = planLoopDecisions(node).find((entry) => entry.id === id);
    if (decision) return { decision, place: { kind: "loop", loopId: node.id } };
  }
  return null;
}

function mapDecisions(
  decisions: readonly AgentPlanDecision[] | undefined,
  transform: (decision: AgentPlanDecision) => AgentPlanDecision | null,
): { readonly decisions?: readonly AgentPlanDecision[] } {
  if (!decisions) return {};
  const mapped = decisions.flatMap((decision) => {
    const next = transform(decision);
    return next ? [next] : [];
  });
  return mapped.length === 0 ? { decisions: undefined } : { decisions: mapped };
}

/** Applies a change to every decision of the plan; `null` removes the decision. */
function mapPlanDecisions<Plan extends AgentPlanInput>(
  plan: Plan,
  transform: (decision: AgentPlanDecision) => AgentPlanDecision | null,
): Plan {
  const nodes = plan.nodes.flatMap((node): readonly AgentPlanNode[] => {
    if (node.type === "decision") {
      const next = transform(node);
      return next ? [next] : [];
    }
    if (node.type === "group")
      return [{ ...node, ...mapDecisions(node.decisions, transform) }];
    if (node.type !== "loop") return [node];
    return [
      {
        ...node,
        ...mapDecisions(node.decisions, transform),
        steps: node.steps.map((member) =>
          member.type === "group"
            ? { ...member, ...mapDecisions(member.decisions, transform) }
            : member,
        ),
      },
    ];
  });
  return { ...plan, nodes };
}

/**
 * Replaces a decision where it stands.
 *
 * @param plan - The plan.
 * @param replacement - The changed decision; its id names the one to replace.
 */
export function replacePlanDecision<Plan extends AgentPlanInput>(
  plan: Plan,
  replacement: AgentPlanDecision,
): Plan {
  return mapPlanDecisions(plan, (decision) =>
    decision.id === replacement.id ? replacement : decision,
  );
}

/** The container of a node inside a group or loop, or `null` for the top level. */
function containerOf(plan: AgentPlanInput, id: string): string | null {
  for (const node of plan.nodes) {
    if (
      node.type === "group" &&
      [...node.steps, ...(node.decisions ?? [])].some(
        (entry) => entry.id === id,
      )
    )
      return node.id;
    if (node.type !== "loop") continue;
    const inside = [
      ...planLoopMembers(node),
      ...planLoopDecisions(node),
      ...planLoopGroups(node),
    ];
    if (inside.some((entry) => entry.id === id)) return node.id;
  }
  return null;
}

function isEdgeOf(edge: AgentPlanEdge, id: string): boolean {
  return edge.from === id || edge.to === id;
}

/** The plan without any edge of the node, wherever the edge was kept. */
function withoutEdgesOf<Plan extends AgentPlanInput>(
  plan: Plan,
  id: string,
): Plan {
  return {
    ...plan,
    edges: plan.edges.filter((edge) => !isEdgeOf(edge, id)),
    nodes: plan.nodes.map((node) => {
      if (
        node.type === "group" &&
        planGroupEdges(node).some((e) => isEdgeOf(e, id))
      )
        return {
          ...node,
          edges: planGroupEdges(node).filter((edge) => !isEdgeOf(edge, id)),
        };
      if (node.type !== "loop") return node;
      return {
        ...node,
        edges: node.edges.filter((edge) => !isEdgeOf(edge, id)),
        steps: node.steps.map((member) =>
          member.type === "group" && member.edges
            ? { ...member, edges: member.edges.filter((e) => !isEdgeOf(e, id)) }
            : member,
        ),
      };
    }),
  };
}

/** Every edge of the node, wherever it is kept. */
function edgesOf(plan: AgentPlanInput, id: string): readonly AgentPlanEdge[] {
  return [
    ...plan.edges,
    ...plan.nodes.flatMap((node): readonly AgentPlanEdge[] => {
      if (node.type === "group") return planGroupEdges(node);
      if (node.type !== "loop") return [];
      return [
        ...node.edges,
        ...planLoopGroups(node).flatMap((group) => group.edges ?? []),
      ];
    }),
  ].filter((edge) => isEdgeOf(edge, id));
}

/** Adds an edge to the list of a container, or to the outer edges for the top level. */
function withEdge<Plan extends AgentPlanInput>(
  plan: Plan,
  edge: AgentPlanEdge,
  containerId: string | null,
): Plan {
  if (containerId === null) return { ...plan, edges: [...plan.edges, edge] };
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.id !== containerId) return node;
      if (node.type === "group")
        return { ...node, edges: [...planGroupEdges(node), edge] };
      return node.type === "loop"
        ? { ...node, edges: [...node.edges, edge] }
        : node;
    }),
  };
}

/** Puts a decision into a container, or at the top level for `null`. */
function withDecision<Plan extends AgentPlanInput>(
  plan: Plan,
  decision: AgentPlanDecision,
  containerId: string | null,
): Plan {
  if (containerId === null)
    return { ...plan, nodes: [...plan.nodes, decision] };
  return {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.id === containerId && (node.type === "group" || node.type === "loop")
        ? { ...node, decisions: [...(node.decisions ?? []), decision] }
        : node,
    ),
  };
}

/** Where an edge of a moved decision may stay: in the container both ends share, or outside for a flow edge into a group. */
function edgePlace(
  edge: AgentPlanEdge,
  here: string | null,
  there: string | null,
  plan: AgentPlanInput,
): string | null | false {
  if (here === there) return here;
  const isGroup = (id: string | null): boolean =>
    id === null ||
    plan.nodes.some((node) => node.id === id && node.type === "group");
  // A flow edge may join a group member and an outer node, as for agents.
  return planEdgeKind(edge) === "flow" && isGroup(here) && isGroup(there)
    ? null
    : false;
}

/**
 * Moves a decision into a group or loop, or out to the top level.
 *
 * @param plan - The plan.
 * @param move - The decision, the target frame (`null` for the top level) and its new position.
 * @returns The plan and the number of edges that could not stay: a condition or
 * branch edge always joins nodes of one container, a flow edge never crosses a
 * loop's border. `null` when the decision or the frame does not exist.
 */
export function placePlanDecision<Plan extends AgentPlanInput>(
  plan: Plan,
  move: {
    readonly decisionId: string;
    readonly frameId: string | null;
    readonly position: AgentPlanPosition;
  },
): { readonly plan: Plan; readonly removedEdges: number } | null {
  const found = findPlanDecision(plan, move.decisionId);
  const frame = plan.nodes.find((node) => node.id === move.frameId);
  if (
    !found ||
    (move.frameId !== null && frame?.type !== "group" && frame?.type !== "loop")
  )
    return null;
  const edges = edgesOf(plan, move.decisionId);
  let next = withoutEdgesOf(
    mapPlanDecisions(plan, (entry) =>
      entry.id === move.decisionId ? null : entry,
    ),
    move.decisionId,
  );
  next = withDecision(
    next,
    { ...found.decision, ...move.position },
    move.frameId,
  );
  let removedEdges = 0;
  for (const edge of edges) {
    const other = edge.from === move.decisionId ? edge.to : edge.from;
    const place = edgePlace(edge, move.frameId, containerOf(next, other), next);
    if (place === false) removedEdges += 1;
    else next = withEdge(next, edge, place);
  }
  return { plan: next, removedEdges };
}

/**
 * The decisions of a container that is dissolved, as nodes of the top level.
 *
 * @param decisions - The decisions the group or loop held.
 * @param offset - Where the container's member area began, so they stay where they were shown.
 */
export function releasedPlanDecisions(
  decisions: readonly AgentPlanDecision[] | undefined,
  offset: AgentPlanPosition,
): readonly AgentPlanDecision[] {
  return (decisions ?? []).map((decision) => ({
    ...decision,
    x: decision.x + offset.x,
    y: decision.y + offset.y,
  }));
}

/**
 * Adds an edge where its ends belong: in the group or loop both share, otherwise to the outer edges.
 *
 * @param plan - The plan.
 * @param edge - The new edge.
 */
export function withPlanEdge<Plan extends AgentPlanInput>(
  plan: Plan,
  edge: AgentPlanEdge,
): Plan {
  const from = containerOf(plan, edge.from);
  return withEdge(
    plan,
    edge,
    from !== null && from === containerOf(plan, edge.to) ? from : null,
  );
}

/**
 * Removes the edges a test matches, wherever they are kept.
 *
 * @param plan - The plan.
 * @param isRemoved - Which edges go.
 */
export function withoutPlanEdges<Plan extends AgentPlanInput>(
  plan: Plan,
  isRemoved: (edge: AgentPlanEdge) => boolean,
): Plan {
  const keep = (edges: readonly AgentPlanEdge[]): readonly AgentPlanEdge[] =>
    edges.filter((edge) => !isRemoved(edge));
  return {
    ...plan,
    edges: keep(plan.edges),
    nodes: plan.nodes.map((node) => {
      if (node.type === "group" && node.edges)
        return { ...node, edges: keep(node.edges) };
      if (node.type !== "loop") return node;
      return {
        ...node,
        edges: keep(node.edges),
        steps: node.steps.map((member) =>
          member.type === "group" && member.edges
            ? { ...member, edges: keep(member.edges) }
            : member,
        ),
      };
    }),
  };
}
