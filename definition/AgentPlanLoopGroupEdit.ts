import { planLoopMembers } from "./AgentPlanLoop";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanGroup } from "./AgentPlanGroup";
import type { AgentPlanLoop, AgentPlanLoopContent } from "./AgentPlanLoop";
import type { PlanFrameMove } from "./AgentPlanLoopEdit";

/** A group and the loop it lies in, `null` for a group of the outer grid. */
export interface PlanGroupLocation {
  readonly group: AgentPlanGroup;
  readonly loop: AgentPlanLoop | null;
}

/** Where a whole group goes: into a loop's member area or onto the outer grid. */
export interface PlanGroupPlacement {
  readonly groupId: string;
  /** The loop that takes the group, `null` for the outer grid. */
  readonly loopId: string | null;
  /** Relative to the member area inside a loop, absolute outside. */
  readonly position: AgentPlanPosition;
}

/** Finds a group of the outer grid or inside a loop. */
export function findPlanGroupLocation(
  plan: AgentPlanInput,
  groupId: string,
): PlanGroupLocation | null {
  for (const node of plan.nodes) {
    if (node.type === "group" && node.id === groupId)
      return { group: node, loop: null };
    if (node.type !== "loop") continue;
    const group = node.steps.find(
      (member): member is AgentPlanGroup =>
        member.type === "group" && member.id === groupId,
    );
    if (group) return { group, loop: node };
  }
  return null;
}

function isResultBinding(binding: AgentPlanBinding): boolean {
  return binding.kind === "result" || binding.kind === "previous";
}

/** The group without bindings of its agents that hand on a result from the side it leaves. */
function withoutCrossingResults(
  group: AgentPlanGroup,
  members: ReadonlySet<string>,
): { readonly group: AgentPlanGroup; readonly dropped: number } {
  let dropped = 0;
  const steps = group.steps.map((step): AgentPlanStep => {
    const entries = Object.entries(step.bindings);
    const kept = entries.filter(
      ([, binding]) =>
        !isResultBinding(binding) ||
        ("stepId" in binding && members.has(binding.stepId)),
    );
    dropped += entries.length - kept.length;
    return { ...step, bindings: Object.fromEntries(kept) };
  });
  return { group: { ...group, steps }, dropped };
}

/** Drops the result bindings of other nodes that read an agent of the group. */
function withoutReaders<Node extends AgentPlanNode>(
  node: Node,
  members: ReadonlySet<string>,
): { readonly node: Node; readonly dropped: number } {
  if (!("bindings" in node)) return { node, dropped: 0 };
  const entries = Object.entries(node.bindings);
  const kept = entries.filter(
    ([, binding]) =>
      !(
        isResultBinding(binding) &&
        "stepId" in binding &&
        members.has(binding.stepId)
      ),
  );
  return {
    node: { ...node, bindings: Object.fromEntries(kept) },
    dropped: entries.length - kept.length,
  };
}

function touchesAny(edge: AgentPlanEdge, ids: ReadonlySet<string>): boolean {
  return ids.has(edge.from) || ids.has(edge.to);
}

/** Takes the group out of where it lies and counts the connections it leaves behind. */
function detachGroup<Plan extends AgentPlanInput>(
  plan: Plan,
  found: PlanGroupLocation,
): PlanFrameMove<Plan> {
  const members = new Set(found.group.steps.map((step) => step.id));
  let removedBindings = 0;
  let removedEdges = 0;
  function clean<Node extends AgentPlanNode>(node: Node): Node {
    const cleaned = withoutReaders(node, members);
    removedBindings += cleaned.dropped;
    return cleaned.node;
  }
  const nodes = plan.nodes
    .filter((node) => node.id !== found.group.id)
    .map((node): AgentPlanNode => {
      if (node.type !== "loop" || node.id !== found.loop?.id)
        return clean(node);
      const edges = node.edges.filter((edge) => !touchesAny(edge, members));
      removedEdges += node.edges.length - edges.length;
      return {
        ...node,
        steps: node.steps
          .filter((step) => step.id !== found.group.id)
          .map((step): AgentPlanLoopContent => clean(step)),
        edges,
      };
    });
  const edges = found.loop
    ? plan.edges
    : plan.edges.filter((edge) => !touchesAny(edge, members));
  removedEdges += plan.edges.length - edges.length;
  return { plan: { ...plan, nodes, edges }, removedEdges, removedBindings };
}

/**
 * Moves a whole group into a loop, within it, out onto the outer grid, or into another loop.
 *
 * @param plan - The plan.
 * @param placement - The group, its target loop or `null`, and its position.
 * @returns The changed plan with what the move cost, or `missingAgent` when
 * the group or the loop is gone. Results never cross the border of a loop, so
 * flow edges and result bindings to the side the group leaves are dropped;
 * the counts name them. Its agents keep sharing one session.
 */
export function placePlanGroupInLoop<Plan extends AgentPlanInput>(
  plan: Plan,
  placement: PlanGroupPlacement,
): PlanFrameMove<Plan> | "missingAgent" {
  const found = findPlanGroupLocation(plan, placement.groupId);
  const target = plan.nodes.find(
    (node): node is AgentPlanLoop =>
      node.type === "loop" && node.id === placement.loopId,
  );
  if (!found || (placement.loopId !== null && !target)) return "missingAgent";
  const moved = { ...found.group, ...placement.position };
  if ((found.loop?.id ?? null) === placement.loopId)
    return {
      plan: replaceGroup(plan, found, moved),
      removedEdges: 0,
      removedBindings: 0,
    };
  const left = detachGroup(plan, found);
  const members = new Set(moved.steps.map((step) => step.id));
  const crossing = withoutCrossingResults(moved, members);
  const nodes = target
    ? left.plan.nodes.map((node) =>
        node.id === target.id && node.type === "loop"
          ? { ...node, steps: [...node.steps, crossing.group] }
          : node,
      )
    : [...left.plan.nodes, crossing.group];
  return {
    plan: { ...left.plan, nodes },
    removedEdges: left.removedEdges,
    removedBindings: left.removedBindings + crossing.dropped,
  };
}

function replaceGroup<Plan extends AgentPlanInput>(
  plan: Plan,
  found: PlanGroupLocation,
  group: AgentPlanGroup,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.id === group.id) return group;
      if (node.type !== "loop" || node.id !== found.loop?.id) return node;
      return {
        ...node,
        steps: node.steps.map((step) => (step.id === group.id ? group : step)),
      };
    }),
  };
}

/**
 * Dissolves a group inside a loop; its agents stay members of the loop.
 *
 * @param plan - The plan.
 * @param groupId - The group inside a loop.
 * @param positionOf - The position of an agent in the loop's member area.
 * @returns The plan with the agents as loop members and the group's edges as
 * loop edges; a plan without such a group stays as it is.
 */
export function ungroupPlanLoopGroup<Plan extends AgentPlanInput>(
  plan: Plan,
  groupId: string,
  positionOf: (step: AgentPlanStep, group: AgentPlanGroup) => AgentPlanPosition,
): Plan {
  const found = findPlanGroupLocation(plan, groupId);
  const loop = found?.loop;
  if (!found || !loop) return plan;
  const { group } = found;
  const edges = planLoopMembers({ steps: [group] }).length
    ? (group.edges ?? [])
    : [];
  return {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.id !== loop.id || node.type !== "loop"
        ? node
        : {
            ...node,
            steps: node.steps.flatMap((step): AgentPlanLoopContent[] =>
              step.id === group.id
                ? group.steps.map((member) => ({
                    ...member,
                    ...positionOf(member, group),
                  }))
                : [step],
            ),
            edges: [...node.edges, ...edges],
          },
    ),
  };
}
