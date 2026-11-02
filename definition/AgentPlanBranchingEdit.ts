import { PLAN_PORT, planBranchPort, planEdgeKind } from "./AgentPlanBranching";

import type {
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanPosition,
} from "./AgentPlan";
import type { AgentPlanBranch } from "./AgentPlanBranching";

/** One connection of the branching contract, as the editor asks for it. */
export type AgentPlanBranchingConnection =
  | {
      /** Leaves a decision through its true or false output into a flow input. */
      readonly kind: "branch";
      readonly from: string;
      readonly branch: AgentPlanBranch;
      readonly to: string;
    }
  | {
      /** The boolean result of an agent enters the condition of a decision. */
      readonly kind: "condition";
      readonly from: string;
      readonly to: string;
    }
  | {
      /** The text result of an agent or script enters the event input of an agent. */
      readonly kind: "event";
      readonly from: string;
      readonly to: string;
    };

/** Creates a decision without a condition; it takes no input but the boolean result connected to it. */
export function emptyPlanDecision(
  id: string,
  position: AgentPlanPosition,
): AgentPlanDecision {
  return { id, type: "decision", ...position };
}

/** The edge a connection stands for. */
export function planBranchingEdge(
  connection: AgentPlanBranchingConnection,
): AgentPlanEdge {
  const { from, to } = connection;
  if (connection.kind === "branch")
    return {
      from,
      to,
      fromPort: planBranchPort(connection.branch),
      toPort: PLAN_PORT.flowIn,
    };
  if (connection.kind === "condition")
    return {
      from,
      to,
      fromPort: PLAN_PORT.passedOut,
      toPort: PLAN_PORT.conditionIn,
    };
  return {
    from,
    to,
    fromPort: PLAN_PORT.valueOut,
    toPort: PLAN_PORT.eventIn,
  };
}

/**
 * Adds the edge of a connection; whether the plan stays valid is the caller's check.
 *
 * @param plan - The draft.
 * @param connection - The connection the person made.
 */
export function connectPlanBranching<Plan extends AgentPlanInput>(
  plan: Plan,
  connection: AgentPlanBranchingConnection,
): Plan {
  return { ...plan, edges: [...plan.edges, planBranchingEdge(connection)] };
}

/**
 * Makes the boolean result of one agent the condition of a decision, or clears it.
 *
 * @param plan - The draft.
 * @param decisionId - The decision whose condition changes.
 * @param agentId - The agent to read, or `null` for no condition.
 *
 * @remarks
 * A decision reads exactly one result, so the earlier condition goes first.
 */
export function setPlanDecisionCondition<Plan extends AgentPlanInput>(
  plan: Plan,
  decisionId: string,
  agentId: string | null,
): Plan {
  const edges = plan.edges.filter(
    (edge) => edge.to !== decisionId || planEdgeKind(edge) !== "condition",
  );
  if (agentId === null) return { ...plan, edges };
  return {
    ...plan,
    edges: [
      ...edges,
      planBranchingEdge({ kind: "condition", from: agentId, to: decisionId }),
    ],
  };
}

/**
 * Removes exactly one edge named by both its nodes and its ports.
 *
 * @param plan - The draft.
 * @param edge - The edge to remove; other edges between the same nodes stay.
 */
export function disconnectPlanEdge<Plan extends AgentPlanInput>(
  plan: Plan,
  edge: AgentPlanEdge,
): Plan {
  return {
    ...plan,
    edges: plan.edges.filter(
      (entry) =>
        entry.from !== edge.from ||
        entry.to !== edge.to ||
        entry.fromPort !== edge.fromPort ||
        entry.toPort !== edge.toPort,
    ),
  };
}
