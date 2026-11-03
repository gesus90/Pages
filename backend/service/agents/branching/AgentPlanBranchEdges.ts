import {
  planEdgeBranch,
  planOrderEdges,
} from "@/definition/AgentPlanBranching";

import type {
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";

/**
 * What one incoming edge says about the node it enters.
 *
 * @remarks
 * `satisfied` releases the node, `dead` can never release it in this round,
 * `pending` still depends on a result to come.
 */
export type PlanEdgeState = "satisfied" | "dead" | "pending";

/** Whether a node can start, can never start in this round, or still waits. */
export type PlanReadiness = "ready" | "skip" | "wait";

/**
 * The state of one execution edge from the result of its source.
 *
 * @param edge - An edge that orders execution.
 * @param source - The result of the node the edge leaves.
 *
 * @remarks
 * A decision satisfies only the edge of the branch it activated and kills the
 * other one; a node that was skipped kills every edge it leaves, and so does a
 * stack whose trigger found it used up. A failed or cancelled source stays
 * pending: the scheduler marks what waits behind it.
 */
export function planEdgeState(
  edge: Pick<AgentPlanEdge, "fromPort">,
  source: Pick<AgentPlanStepResult, "status" | "branch" | "stack"> | undefined,
): PlanEdgeState {
  if (source === undefined) return "pending";
  if (source.status === "skipped") return "dead";
  if (source.status !== "succeeded") return "pending";
  if (source.stack?.entryId === null) return "dead";
  const branch = planEdgeBranch(edge);
  if (branch === null) return "satisfied";
  return source.branch === branch ? "satisfied" : "dead";
}

/**
 * Whether a waiting node may start, can no longer start, or has to wait.
 *
 * @param plan - The frozen plan.
 * @param results - The results of the run by node.
 * @param nodeId - The waiting node.
 *
 * @remarks
 * A node without incoming edges starts at once. Otherwise every incoming
 * edge must have an answer, and one satisfied edge is enough: after a
 * decision, the branches meet again at a node that follows either one. When
 * every edge is dead the node is skipped, which spreads along the branch.
 */
export function planReadiness(
  plan: Pick<AgentPlanInput, "edges">,
  results: ReadonlyMap<string, AgentPlanStepResult>,
  nodeId: string,
): PlanReadiness {
  const states = planOrderEdges(plan.edges)
    .filter((edge) => edge.to === nodeId)
    .map((edge) => planEdgeState(edge, results.get(edge.from)));
  if (states.length === 0) return "ready";
  if (states.includes("pending")) return "wait";
  return states.includes("satisfied") ? "ready" : "skip";
}
