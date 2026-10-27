import { planLoopEntries, planLoopExits, planLoopOf } from "./AgentPlanLoop";

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
import type { AgentPlanLoop, AgentPlanLoopMember } from "./AgentPlanLoop";

/** An agent or script node and the frame it belongs to; both `null` outside every frame. */
export interface PlanNodeLocation {
  readonly node: AgentPlanLoopMember;
  readonly group: AgentPlanGroup | null;
  readonly loop: AgentPlanLoop | null;
}

/** A plan after a node crossed a frame, with what it had to give up. */
export interface PlanFrameMove<Plan extends AgentPlanInput> {
  readonly plan: Plan;
  /** Flow edges that reached the node on the side it left. */
  readonly removedEdges: number;
  /** Bindings that would have crossed the border of a loop. */
  readonly removedBindings: number;
}

/** Where an agent or script node is placed: a loop's member area or the outer grid. */
export interface PlanNodePlacement {
  readonly nodeId: string;
  /** The loop that takes the node, `null` for the outer grid. */
  readonly loopId: string | null;
  /** Relative to the member area inside a loop, absolute outside. */
  readonly position: AgentPlanPosition;
}

/** Finds the loop member with this ID, with its loop. */
export function findPlanLoopMember(
  plan: AgentPlanInput,
  id: string,
): {
  readonly member: AgentPlanLoopMember;
  readonly loop: AgentPlanLoop;
} | null {
  const loop = planLoopOf(plan, id);
  const member = loop?.steps.find((step) => step.id === id);
  return loop && member ? { member, loop } : null;
}

function touches(edge: AgentPlanEdge, id: string): boolean {
  return edge.from === id || edge.to === id;
}

/** Whether a binding hands on a result, which must not cross the border of a loop. */
function isResultBinding(binding: AgentPlanBinding): boolean {
  return binding.kind === "result" || binding.kind === "previous";
}

function withoutResultBindings<Node extends AgentPlanLoopMember>(
  node: Node,
  isDropped: (binding: AgentPlanBinding) => boolean,
): { readonly node: Node; readonly dropped: number } {
  const entries = Object.entries(node.bindings);
  const kept = entries.filter(([, binding]) => !isDropped(binding));
  return {
    node: { ...node, bindings: Object.fromEntries(kept) },
    dropped: entries.length - kept.length,
  };
}

/**
 * Takes a node out of its loop; its connections to the other members end with it.
 *
 * @remarks
 * Results stay inside the loop, so the bindings between the node and the
 * others that hand a result on are dropped on both sides.
 */
function leaveLoop<Plan extends AgentPlanInput>(
  plan: Plan,
  location: {
    readonly member: AgentPlanLoopMember;
    readonly loop: AgentPlanLoop;
  },
): {
  readonly plan: Plan;
  readonly node: AgentPlanLoopMember;
  readonly moved: PlanFrameMove<Plan>;
} {
  const { member, loop } = location;
  const own = withoutResultBindings(member, isResultBinding);
  let removedBindings = own.dropped;
  const steps = loop.steps
    .filter((step) => step.id !== member.id)
    .map((step) => {
      const cleaned = withoutResultBindings(
        step,
        (binding) =>
          isResultBinding(binding) &&
          "stepId" in binding &&
          binding.stepId === member.id,
      );
      removedBindings += cleaned.dropped;
      return cleaned.node;
    });
  const edges = loop.edges.filter((edge) => !touches(edge, member.id));
  const removedEdges = loop.edges.length - edges.length;
  const left: AgentPlanLoop = {
    ...loop,
    steps,
    edges,
    condition:
      loop.condition?.sourceNodeId === member.id
        ? { ...loop.condition, sourceNodeId: "" }
        : loop.condition,
  };
  const next = {
    ...plan,
    nodes: plan.nodes.map((node) => (node.id === loop.id ? left : node)),
  };
  return {
    plan: next,
    node: own.node,
    moved: { plan: next, removedEdges, removedBindings },
  };
}

/** Takes an outer node onto a loop; its outer connections end, as do result bindings to outer nodes. */
function leaveOuter<Plan extends AgentPlanInput>(
  plan: Plan,
  node: AgentPlanLoopMember,
): {
  readonly plan: Plan;
  readonly node: AgentPlanLoopMember;
  readonly moved: PlanFrameMove<Plan>;
} {
  const own = withoutResultBindings(node, isResultBinding);
  let removedBindings = own.dropped;
  const nodes = plan.nodes
    .filter((entry) => entry.id !== node.id)
    .map((entry): AgentPlanNode => {
      if (entry.type !== "agent" && entry.type !== "script") return entry;
      const cleaned = withoutResultBindings(
        entry,
        (binding) =>
          isResultBinding(binding) &&
          "stepId" in binding &&
          binding.stepId === node.id,
      );
      removedBindings += cleaned.dropped;
      return cleaned.node;
    });
  const edges = plan.edges.filter((edge) => !touches(edge, node.id));
  const next = { ...plan, nodes, edges };
  return {
    plan: next,
    node: own.node,
    moved: {
      plan: next,
      removedEdges: plan.edges.length - edges.length,
      removedBindings,
    },
  };
}

/** The location of an agent or script node: outside every frame, in a group or in a loop. */
export function findPlanNodeLocation(
  plan: AgentPlanInput,
  id: string,
): PlanNodeLocation | null {
  for (const node of plan.nodes) {
    if ((node.type === "agent" || node.type === "script") && node.id === id)
      return { node, group: null, loop: null };
    if (node.type === "group") {
      const step = node.steps.find((entry) => entry.id === id);
      if (step) return { node: step, group: node, loop: null };
    }
    if (node.type === "loop") {
      const member = node.steps.find((entry) => entry.id === id);
      if (member) return { node: member, group: null, loop: node };
    }
  }
  return null;
}

/** A node on its way between two places, with what the way has cost so far. */
interface MoveState<Plan extends AgentPlanInput> {
  readonly plan: Plan;
  readonly node: AgentPlanLoopMember;
  readonly removedEdges: number;
  readonly removedBindings: number;
  /** Whether the node already left every loop, so it only has to enter one. */
  readonly isOuterGridFree: boolean;
}

interface MoveContext<Plan extends AgentPlanInput> {
  readonly agents: readonly AgentDefinitionChoice[];
  /** Moves an agent between a group and the outer grid, the established group edit. */
  readonly detachFromGroup: (
    plan: Plan,
    step: AgentPlanStep,
    position: AgentPlanPosition,
  ) => Plan | AgentPlanGroupRefusal;
}

/** Takes the node out of its group or loop, onto the outer grid or into limbo for a loop. */
function detachNode<Plan extends AgentPlanInput>(
  plan: Plan,
  found: PlanNodeLocation,
  placement: PlanNodePlacement,
  context: MoveContext<Plan>,
): MoveState<Plan> | AgentPlanGroupRefusal {
  const moved = { ...found.node, ...placement.position };
  let current: Plan = plan;
  if (found.group && found.node.type === "agent") {
    const step: AgentPlanStep = { ...found.node, ...placement.position };
    const detached = context.detachFromGroup(plan, step, placement.position);
    if (typeof detached === "string") return detached;
    current = detached;
  }
  if (!found.loop)
    return {
      plan: current,
      node: moved,
      removedEdges: 0,
      removedBindings: 0,
      isOuterGridFree: false,
    };
  const left = leaveLoop(current, { member: moved, loop: found.loop });
  return {
    plan: left.plan,
    node: left.node,
    removedEdges: left.moved.removedEdges,
    removedBindings: left.moved.removedBindings,
    isOuterGridFree: true,
  };
}

/** Puts the node into a loop; a node that came from the outer grid gives up its outer connections first. */
function attachToLoop<Plan extends AgentPlanInput>(
  state: MoveState<Plan>,
  loop: AgentPlanLoop,
): PlanFrameMove<Plan> {
  const entered = state.isOuterGridFree
    ? null
    : leaveOuter(state.plan, state.node);
  const plan = entered?.plan ?? state.plan;
  const node = entered?.node ?? state.node;
  const placed: AgentPlanLoop = { ...loop, steps: [...loop.steps, node] };
  return {
    plan: {
      ...plan,
      nodes: plan.nodes.map((entry) => (entry.id === loop.id ? placed : entry)),
    },
    removedEdges: state.removedEdges + (entered?.moved.removedEdges ?? 0),
    removedBindings:
      state.removedBindings + (entered?.moved.removedBindings ?? 0),
  };
}

/**
 * Moves an agent or script node into a loop, within it, or out onto the outer grid.
 *
 * @param plan - The plan.
 * @param placement - The node, its target loop or `null`, and its position.
 * @param context - The agents the editor knows and the group edit that frees
 * an agent from its group.
 * @returns The changed plan with what the move cost, or the refusal of a
 * group that does not take the node. Results never cross the border of a loop,
 * so a node that enters or leaves one gives up its flow edges and its result
 * bindings to the other side; the counts name them.
 */
export function placePlanLoopNode<Plan extends AgentPlanInput>(
  plan: Plan,
  placement: PlanNodePlacement,
  context: MoveContext<Plan>,
): PlanFrameMove<Plan> | AgentPlanGroupRefusal {
  const found = findPlanNodeLocation(plan, placement.nodeId);
  if (!found) return "missingAgent";
  const target = plan.nodes.find(
    (node): node is AgentPlanLoop =>
      node.type === "loop" && node.id === placement.loopId,
  );
  if (placement.loopId !== null && !target) return "missingAgent";
  if (found.loop && found.loop.id === target?.id)
    return {
      plan: replaceLoopMember(plan, { ...found.node, ...placement.position }),
      removedEdges: 0,
      removedBindings: 0,
    };
  const left = detachNode(plan, found, placement, context);
  if (typeof left === "string") return left;
  if (target) return attachToLoop(left, target);
  return {
    plan: { ...left.plan, nodes: [...left.plan.nodes, left.node] },
    removedEdges: left.removedEdges,
    removedBindings: left.removedBindings,
  };
}

/**
 * Removes a loop and keeps its members as nodes of the outer graph.
 *
 * @param plan - The plan with the loop.
 * @param loopId - The loop to remove.
 * @param positionOf - The absolute grid position of a member, so it stays
 * where the loop showed it.
 * @returns The plan with the members, their internal edges as outer edges
 * and the loop's outer edges attached to its entries and exits. A binding to
 * the previous iteration has no meaning outside a loop and is dropped; the
 * count names those.
 */
export function ungroupPlanLoop<Plan extends AgentPlanInput>(
  plan: Plan,
  loopId: string,
  positionOf: (member: AgentPlanLoopMember) => AgentPlanPosition,
): PlanFrameMove<Plan> {
  const loop = plan.nodes.find(
    (node): node is AgentPlanLoop => node.type === "loop" && node.id === loopId,
  );
  if (!loop) return { plan, removedEdges: 0, removedBindings: 0 };
  let removedBindings = 0;
  const members = loop.steps.map((member) => {
    const cleaned = withoutResultBindings(
      member,
      (binding) => binding.kind === "previous",
    );
    removedBindings += cleaned.dropped;
    return { ...cleaned.node, ...positionOf(member) };
  });
  const entries = planLoopEntries(loop).map((member) => member.id);
  const exits = planLoopExits(loop).map((member) => member.id);
  const outer = plan.edges.flatMap((edge): AgentPlanEdge[] => {
    const sources = edge.from === loopId ? exits : [edge.from];
    const targets = edge.to === loopId ? entries : [edge.to];
    return sources.flatMap((from) =>
      targets.map((to) => ({ ...edge, from, to })),
    );
  });
  return {
    plan: {
      ...plan,
      nodes: [...plan.nodes.filter((node) => node.id !== loopId), ...members],
      edges: [...outer, ...loop.edges],
    },
    removedEdges: 0,
    removedBindings,
  };
}

/** Replaces a member of a loop by its ID. */
export function replaceLoopMember<Plan extends AgentPlanInput>(
  plan: Plan,
  replacement: AgentPlanLoopMember,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.type === "loop" &&
      node.steps.some((step) => step.id === replacement.id)
        ? {
            ...node,
            steps: node.steps.map((step) =>
              step.id === replacement.id ? replacement : step,
            ),
          }
        : node,
    ),
  };
}

/** Adds a flow edge inside a loop; both ends must be members of that loop. */
export function connectLoopFlow<Plan extends AgentPlanInput>(
  plan: Plan,
  loop: AgentPlanLoop,
  edge: AgentPlanEdge,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.id === loop.id && node.type === "loop"
        ? { ...node, edges: [...node.edges, edge] }
        : node,
    ),
  };
}

/** Removes one internal flow edge of a loop and keeps both members. */
export function disconnectLoopFlow<Plan extends AgentPlanInput>(
  plan: Plan,
  loopId: string,
  link: Pick<AgentPlanEdge, "from" | "to">,
): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((node) =>
      node.type === "loop" && node.id === loopId
        ? {
            ...node,
            edges: node.edges.filter(
              (edge) => edge.from !== link.from || edge.to !== link.to,
            ),
          }
        : node,
    ),
  };
}
