import type { AgentPlanEdge } from "./AgentPlan";

/** The nodes each node's flow edges lead to, and the number of edges it was built from. */
interface FlowIndex {
  readonly size: number;
  readonly followers: ReadonlyMap<string, readonly string[]>;
  readonly predecessors: ReadonlyMap<string, readonly string[]>;
}

// An edge list is replaced, never changed, so its index stays valid for its lifetime.
const indexes = new WeakMap<readonly AgentPlanEdge[], FlowIndex>();

function addEdge(
  index: Map<string, string[]>,
  node: string,
  neighbour: string,
): void {
  const neighbours = index.get(node);
  if (neighbours) neighbours.push(neighbour);
  else index.set(node, [neighbour]);
}

/**
 * Indexes the edges once per edge list.
 *
 * @remarks
 * A validation asks for the path between many pairs of nodes of one plan.
 * Scanning every edge at every step made that quadratic in the nodes and
 * edges, which took minutes for a plan of a few hundred nodes.
 */
function flowIndex(edges: readonly AgentPlanEdge[]): FlowIndex {
  const known = indexes.get(edges);
  if (known?.size === edges.length) return known;
  const followers = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    addEdge(followers, edge.from, edge.to);
    addEdge(predecessors, edge.to, edge.from);
  }
  const index = { size: edges.length, followers, predecessors };
  indexes.set(edges, index);
  return index;
}

/** Follows only flow edges; data connections never create scheduling dependencies. */
export function hasPlanPath(
  edges: readonly AgentPlanEdge[],
  from: string,
  to: string,
): boolean {
  const { followers } = flowIndex(edges);
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const next of followers.get(current) ?? []) {
      if (next === to) return true;
      pending.push(next);
    }
  }
  return false;
}

/**
 * Every node with a flow path to the node, found in one walk against the edges.
 *
 * @param edges - The flow edges of the plan.
 * @param to - The node whose predecessors are wanted.
 * @returns The nodes that reach `to`; `to` itself only when it lies on a cycle.
 */
export function planPredecessors(
  edges: readonly AgentPlanEdge[],
  to: string,
): ReadonlySet<string> {
  const { predecessors } = flowIndex(edges);
  const reached = new Set<string>();
  const pending = [to];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const previous of predecessors.get(current) ?? []) {
      reached.add(previous);
      pending.push(previous);
    }
  }
  return reached;
}
