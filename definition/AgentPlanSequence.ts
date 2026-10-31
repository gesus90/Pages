import { isPlanFlowNode } from "./AgentPlanGraph";
import { expandPlanGroups } from "./AgentPlanGroup";
import { withPortlessPlanGroups } from "./AgentPlanGroupUpgrade";

import type { AgentPlanInput, AgentPlanNode } from "./AgentPlan";

/** Why a flow node has no number: no flow edge from Start reaches it, or it lies in or behind a cycle. */
export type AgentPlanSequenceGap = "unreachable" | "cycle";

/**
 * The numbering of a plan's flow nodes along its flow edges.
 *
 * @remarks
 * `order` holds the numbered nodes, number one first. A node that cannot be
 * numbered is named in `gaps` instead of being slotted in somewhere.
 */
export interface AgentPlanSequence {
  readonly order: readonly string[];
  readonly gaps: readonly {
    readonly id: string;
    readonly reason: AgentPlanSequenceGap;
  }[];
}

/** Start comes first and End last; every other node sorts between them by its depth. */
const BOUNDARY_RANK = { start: 0, end: 2 } as const;

function boundaryRank(node: AgentPlanNode): number {
  return node.type === "start" || node.type === "end"
    ? BOUNDARY_RANK[node.type]
    : 1;
}

/** Orders identifiers by code unit, which is stable across locales; identifiers are unique, so no tie exists. */
function compareIds(first: string, second: string): number {
  return first < second ? -1 : 1;
}

/** Reads a map entry, falling back to a default for an id that has none yet. */
function lookup<Value>(
  map: ReadonlyMap<string, Value>,
  id: string,
  fallback: Value,
): Value {
  return map.get(id) ?? fallback;
}

/**
 * The flow edges between flow nodes; data bindings never order execution.
 *
 * @remarks
 * An edge into a Start or out of an End is invalid, and the graph validation
 * reports it; it would only hide the boundary node from the numbering.
 */
function flowSuccessors(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  nodes: ReadonlyMap<string, AgentPlanNode>,
): ReadonlyMap<string, readonly string[]> {
  const successors = new Map<string, string[]>();
  for (const edge of plan.edges) {
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    if (!source || !target || target.type === "start" || source.type === "end")
      continue;
    const entries = successors.get(edge.from) ?? [];
    if (!entries.includes(edge.to)) entries.push(edge.to);
    successors.set(edge.from, entries);
  }
  return successors;
}

function reachableFrom(
  starts: readonly string[],
  successors: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const reached = new Set<string>();
  const pending = [...starts];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || reached.has(current)) continue;
    reached.add(current);
    pending.push(...(successors.get(current) ?? []));
  }
  return reached;
}

/**
 * The longest flow path from a Start to each node that a cycle does not block.
 *
 * @remarks
 * A node is settled once every flow edge into it is settled; nodes in or
 * behind a cycle never settle and are missing from the result.
 */
function flowDepths(
  reached: ReadonlySet<string>,
  successors: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, number> {
  const incoming = new Map([...reached].map((id) => [id, 0]));
  for (const id of reached)
    for (const next of successors.get(id) ?? [])
      incoming.set(next, lookup(incoming, next, 0) + 1);
  const candidates = new Map<string, number>();
  const settled = new Map<string, number>();
  const ready = [...reached].filter((id) => incoming.get(id) === 0);
  for (
    let current = ready.pop();
    current !== undefined;
    current = ready.pop()
  ) {
    const depth = lookup(candidates, current, 0);
    settled.set(current, depth);
    for (const next of successors.get(current) ?? []) {
      candidates.set(next, Math.max(lookup(candidates, next, 0), depth + 1));
      const remaining = lookup(incoming, next, 0) - 1;
      incoming.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  return settled;
}

/** The flow nodes of a plan, those Start reaches, and the depth of each node a cycle does not block. */
function flowGraph(plan: Pick<AgentPlanInput, "nodes" | "edges">): {
  readonly nodes: ReadonlyMap<string, AgentPlanNode>;
  readonly reached: ReadonlySet<string>;
  readonly depths: ReadonlyMap<string, number>;
} {
  const nodes = new Map(
    plan.nodes.filter(isPlanFlowNode).map((node) => [node.id, node]),
  );
  const successors = flowSuccessors(plan, nodes);
  const starts = [...nodes.values()]
    .filter((node) => node.type === "start")
    .map((node) => node.id);
  const reached = reachableFrom(starts, successors);
  return { nodes, reached, depths: flowDepths(reached, successors) };
}

/**
 * Numbers the flow nodes of a plan along its directed flow edges.
 *
 * @param plan - A plan whose groups are expanded, so that group members are
 * flow nodes of their own; a loop counts as one node.
 *
 * @remarks
 * Start is number one and End the last number. In between, a node follows
 * every node with a flow edge to it: nodes sort by the longest flow path
 * from Start, and nodes on the same step, such as parallel branches, sort by
 * their stable node identifier. The array order of the nodes, their creation,
 * their canvas position and the run state never change a number, and the
 * numbers create no edge between parallel nodes. Nodes that Start does not
 * reach, and nodes in or behind a cycle, get no number and are named as gaps.
 */
export function planFlowSequence(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
): AgentPlanSequence {
  const { nodes, reached, depths } = flowGraph(plan);
  const ranks = new Map(
    [...nodes].map(([id, node]) => [id, boundaryRank(node)] as const),
  );
  const order = [...depths.keys()].sort((first, second) => {
    const rank = lookup(ranks, first, 1) - lookup(ranks, second, 1);
    if (rank !== 0) return rank;
    const depth = lookup(depths, first, 0) - lookup(depths, second, 0);
    return depth === 0 ? compareIds(first, second) : depth;
  });
  const gaps = [...nodes.keys()]
    .filter((id) => !depths.has(id))
    .sort(compareIds)
    .map((id) => ({
      id,
      reason: reached.has(id) ? ("cycle" as const) : ("unreachable" as const),
    }));
  return { order, gaps };
}

/**
 * Groups the numbered flow nodes of a plan by their step along the flow edges.
 *
 * @param plan - A plan whose groups are expanded, as for {@link planFlowSequence}.
 * @returns The node identifiers of each step, the step nearest to Start first.
 * Nodes on the same step, such as parallel branches, sort by identifier; Start
 * and End form a step of their own. Nodes without a number are left out.
 */
export function planFlowStages(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
): readonly (readonly string[])[] {
  const stages = new Map<number, string[]>();
  for (const [id, depth] of flowGraph(plan).depths)
    stages.set(depth, [...(stages.get(depth) ?? []), id]);
  return [...stages.keys()]
    .sort((first, second) => first - second)
    .map((depth) => (stages.get(depth) ?? []).sort(compareIds));
}

/**
 * The numbering a run of the plan executes.
 *
 * @remarks
 * Groups are expanded into their members, as in the snapshot of a run, so a
 * plan and its runs number the same nodes alike.
 */
export function planRunSequence(plan: AgentPlanInput): AgentPlanSequence {
  return planFlowSequence(expandPlanGroups(withPortlessPlanGroups(plan)));
}

/**
 * Sorts entries, such as the steps of a run, into the order of a sequence.
 *
 * @remarks
 * Entries the sequence does not number keep their relative order behind the
 * numbered ones; nothing is dropped.
 */
export function inPlanSequence<Entry extends { readonly id: string }>(
  entries: readonly Entry[],
  order: readonly string[],
): readonly Entry[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (first, second) =>
        (positions.get(first.entry.id) ?? order.length + first.index) -
        (positions.get(second.entry.id) ?? order.length + second.index),
    )
    .map(({ entry }) => entry);
}
