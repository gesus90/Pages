import type { AgentPlanEdge } from "./AgentPlan";

/** Follows only flow edges; data connections never create scheduling dependencies. */
export function hasPlanPath(
  edges: readonly AgentPlanEdge[],
  from: string,
  to: string,
): boolean {
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const edge of edges.filter((entry) => entry.from === current)) {
      if (edge.to === to) return true;
      pending.push(edge.to);
    }
  }
  return false;
}
