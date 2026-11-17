import {
  allPlanLoops,
  planGroupContent,
  mapPlanLoops,
  planLoopOwner,
} from "./AgentPlanGroupLoop";
import { connectLoopFlow, replaceLoopMember } from "./AgentPlanLoopEdit";
import { planLoopOf } from "./AgentPlanLoop";
import {
  planGroupEdges,
  planGroupRefusal,
  planGroupEntries,
  planGroupExits,
  resolvePlanGroupBinding,
} from "./AgentPlanGroup";
import { findPlanDecision, replacePlanDecision } from "./AgentPlanDecisionEdit";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type {
  AgentPlanBinding,
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanEnd,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanPosition,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanGroup, AgentPlanGroupRefusal } from "./AgentPlanGroup";
import type { AgentPlanJumpOut, AgentPlanSignal } from "./AgentPlanJump";
import type { AgentPlanLoop } from "./AgentPlanLoop";
import type { AgentPlanGitCloseout } from "./AgentPlanGitCloseout";
import type { AgentPlanScript } from "./AgentPlanScript";

/** Grid columns between members when an older group is laid out in its frame. */
const MEMBER_COLUMN = 320;

/** An agent node and the frame it belongs to; both `null` for a node outside every frame. */
export interface PlanStepLocation {
  readonly step: AgentPlanStep;
  readonly group: AgentPlanGroup | null;
  readonly loop: AgentPlanLoop | null;
}

/**
 * A plan after an agent node crossed a frame, with what it had to give up.
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
      return { step: node, group: null, loop: null };
    if (node.type === "loop") {
      const found = loopStep(node, id);
      if (found) return found;
    }
    if (node.type !== "group") continue;
    const step = node.steps.find((entry) => entry.id === id);
    if (step) return { step, group: node, loop: null };
  }
  for (const loop of allPlanLoops(plan)) {
    const found = loopStep(loop, id);
    if (found)
      return {
        ...found,
        group: found.group ?? planLoopOwner(plan, loop.id) ?? null,
      };
  }
  return null;
}

/** An agent of a loop, directly or inside a group of the loop. */
function loopStep(loop: AgentPlanLoop, id: string): PlanStepLocation | null {
  for (const member of loop.steps) {
    if (member.type === "agent" && member.id === id)
      return { step: member, group: null, loop };
    if (member.type !== "group") continue;
    const step = member.steps.find((entry) => entry.id === id);
    if (step) return { step, group: member, loop };
  }
  return null;
}

/**
 * Finds the node whose inputs a binding fills: an agent, also inside a
 * frame, a script, a frame with its retained legacy inputs, an outgoing Jump
 * or a signal.
 * @remarks
 * An end binds its returns too, but it declares them optionally; use
 * {@link bindPlanParameter} and {@link unbindPlanParameter} for those.
 */
export function findPlanBindingTarget(
  plan: AgentPlanInput,
  id: string,
):
  | AgentPlanStep
  | AgentPlanScript
  | AgentPlanGitCloseout
  | AgentPlanGroup
  | AgentPlanLoop
  | AgentPlanJumpOut
  | AgentPlanSignal
  | null {
  return (
    findPlanStep(plan, id)?.step ??
    allPlanLoops(plan).find((loop) => loop.id === id) ??
    planLoopOf(plan, id)?.steps.find(
      (member): member is AgentPlanScript =>
        member.type === "script" && member.id === id,
    ) ??
    plan.nodes.find(
      (
        node,
      ): node is
        | AgentPlanScript
        | AgentPlanGitCloseout
        | AgentPlanGroup
        | AgentPlanLoop
        | AgentPlanJumpOut
        | AgentPlanSignal =>
        (node.type === "script" ||
          node.type === "git_closeout" ||
          node.type === "group" ||
          node.type === "loop" ||
          node.type === "signal" ||
          (node.type === "jump" && node.direction === "out")) &&
        node.id === id,
    ) ??
    null
  );
}

/** Replaces a node by its identifier, also an agent inside a frame. */
export function replacePlanNode<Plan extends AgentPlanInput>(
  plan: Plan,
  replacement: AgentPlanNode,
): Plan {
  if (replacement.type === "loop")
    return mapPlanLoops(plan, (loop) =>
      loop.id === replacement.id ? replacement : loop,
    );
  if (replacement.type === "decision")
    return replacePlanDecision(plan, replacement);
  if (
    (replacement.type === "agent" ||
      replacement.type === "script" ||
      replacement.type === "group") &&
    planLoopOf(plan, replacement.id)
  )
    return replaceLoopMember(plan, replacement);
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
  if (found.loop && (found.group?.id ?? null) !== placement.groupId)
    return "nestedGroup";
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
  positionOf: (
    step: AgentPlanStep | AgentPlanLoop | AgentPlanDecision,
  ) => AgentPlanPosition,
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
      nodes: [
        ...plan.nodes.filter((node) => node.id !== groupId),
        ...members,
        ...(group.loops ?? []).map((loop) => ({
          ...loop,
          ...positionOf(loop),
        })),
        // A decision of the frame stays a decision of the outer graph.
        ...(group.decisions ?? []).map((decision) => ({
          ...decision,
          ...positionOf(decision),
        })),
      ],
      edges: [...edges, ...planGroupEdges(group)],
    },
    removedEdges: 0,
    removedBindings: 0,
  };
}

/**
 * Adds an explicit edge between actual agents or checkpoints, across frames too.
 * @returns The plan, or `groupBoundary` when an endpoint names a group and
 * `loopBoundary` when an edge would join a member of a loop to anything
 * outside it. A loop itself is an ordinary node of the outer graph.
 */
export function connectPlanFlow<Plan extends AgentPlanInput>(
  plan: Plan,
  from: string,
  to: string,
): Plan | "groupBoundary" | "loopBoundary" {
  const edge = { from, to, fromPort: "flow-out", toPort: "flow-in" };
  // A stack stays an outer node; its edges to loop members make it a step of that loop.
  if (isStack(plan, from) || isStack(plan, to))
    return { ...plan, edges: [...plan.edges, edge] };
  const sourceLoop = planLoopOf(plan, from);
  if (sourceLoop || planLoopOf(plan, to))
    return connectInsideLoop(plan, sourceLoop, edge);
  const source = memberGroup(plan, from);
  const target = memberGroup(plan, to);
  if (
    plan.nodes.some(
      (node) => node.type === "group" && (node.id === from || node.id === to),
    )
  )
    return "groupBoundary";
  if (!source || source.id !== target?.id)
    return { ...plan, edges: [...plan.edges, edge] };
  return replacePlanNode(plan, {
    ...source,
    edges: [...planGroupEdges(source), edge],
  });
}

/** The group an agent or a decision belongs to, if any. */
function memberGroup(plan: AgentPlanInput, id: string): AgentPlanGroup | null {
  const loopOwner = plan.nodes.find(
    (node): node is AgentPlanGroup =>
      node.type === "group" &&
      node.loops?.some((loop) => loop.id === id) === true,
  );
  if (loopOwner) return loopOwner;
  const step = findPlanStep(plan, id)?.group;
  if (step) return step;
  const place = findPlanDecision(plan, id)?.place;
  if (place?.kind !== "group") return null;
  return (
    plan.nodes.find(
      (node): node is AgentPlanGroup =>
        node.type === "group" && node.id === place.groupId,
    ) ?? null
  );
}

/**
 * Adds an edge between two members of one loop: into their group when both share one, else into the loop.
 * @returns `loopBoundary` when the other end lies outside the loop.
 */
function connectInsideLoop<Plan extends AgentPlanInput>(
  plan: Plan,
  loop: AgentPlanLoop | undefined,
  edge: AgentPlanEdge,
): Plan | "loopBoundary" {
  if (!loop || planLoopOf(plan, edge.to)?.id !== loop.id) return "loopBoundary";
  const source = findPlanStep(plan, edge.from)?.group;
  const target = findPlanStep(plan, edge.to)?.group;
  if (
    source &&
    source.id === target?.id &&
    source.id !== planLoopOwner(plan, loop.id)?.id
  )
    return replacePlanNode(plan, {
      ...source,
      edges: [...planGroupEdges(source), edge],
    });
  return connectLoopFlow(plan, loop, edge);
}

/** Whether the node is a stack. */
function isStack(plan: AgentPlanInput, id: string): boolean {
  return plan.nodes.some((node) => node.id === id && node.type === "stack");
}

/** Removes one internal flow edge of a group, also inside a loop, and keeps both members. */
export function disconnectPlanGroupFlow<Plan extends AgentPlanInput>(
  plan: Plan,
  groupId: string,
  link: Pick<AgentPlanEdge, "from" | "to">,
): Plan {
  function without(group: AgentPlanGroup): AgentPlanGroup {
    return {
      ...group,
      edges: planGroupEdges(group).filter(
        (edge) => edge.from !== link.from || edge.to !== link.to,
      ),
    };
  }
  return {
    ...plan,
    nodes: plan.nodes.map((node) => {
      if (node.type === "group" && node.id === groupId) return without(node);
      if (node.type !== "loop") return node;
      return {
        ...node,
        steps: node.steps.map((step) =>
          step.type === "group" && step.id === groupId ? without(step) : step,
        ),
      };
    }),
  };
}

/**
 * Gives every group saved before internal edges existed its explicit edges and a member layout.
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

/** The end of the plan with the id, which binds its returns like an input. */
function findPlanEnd(plan: AgentPlanInput, id: string): AgentPlanEnd | null {
  return (
    plan.nodes.find(
      (node): node is AgentPlanEnd => node.type === "end" && node.id === id,
    ) ?? null
  );
}

/**
 * Binds an input of an agent node, also of one inside a frame, of a script,
 * of an outgoing Jump or of a signal, or a returned value of an end.
 */
export function bindPlanParameter<Plan extends AgentPlanInput>(
  plan: Plan,
  targetId: string,
  parameter: string,
  binding: AgentPlanBinding,
): Plan {
  const end = findPlanEnd(plan, targetId);
  if (end)
    return replacePlanNode(plan, {
      ...end,
      bindings: { ...end.bindings, [parameter]: binding },
    });
  const target = findPlanBindingTarget(plan, targetId);
  if (!target) return plan;
  return replacePlanNode(plan, {
    ...target,
    bindings: { ...target.bindings, [parameter]: binding },
  });
}

/**
 * Releases the binding of one input or returned value; the node and its declarations stay.
 * @param plan - The draft.
 * @param targetId - The node whose input is released.
 * @param parameter - The name of the input, or of the returned value of an end.
 */
export function unbindPlanParameter<Plan extends AgentPlanInput>(
  plan: Plan,
  targetId: string,
  parameter: string,
): Plan {
  const end = findPlanEnd(plan, targetId);
  const target = end ?? findPlanBindingTarget(plan, targetId);
  if (!target) return plan;
  const bindings = Object.fromEntries(
    Object.entries(target.bindings ?? {}).filter(([key]) => key !== parameter),
  );
  return replacePlanNode(plan, { ...target, bindings });
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
    planGroupContent(group).some((step) => step.id === edge.from) &&
    planGroupContent(group).some((step) => step.id === edge.to)
  );
}
