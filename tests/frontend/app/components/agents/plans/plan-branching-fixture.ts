import { agentNode, flowEdge, planOf } from "./plan-group-fixture";

import type {
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanInput,
} from "@/definition/AgentPlan";
import type { AgentPlanBranch } from "@/definition/AgentPlanBranching";

/** The boolean result of an agent into the condition of a decision. */
export function conditionEdge(from: string, to: string): AgentPlanEdge {
  return { from, to, fromPort: "passed-out", toPort: "condition-in" };
}

/** An output of a decision into a flow input. */
export function branchEdge(
  from: string,
  branch: AgentPlanBranch,
  to: string,
): AgentPlanEdge {
  return { from, to, fromPort: `${branch}-out`, toPort: "flow-in" };
}

/** The text result of a node into the event input of an agent. */
export function eventEdge(from: string, to: string): AgentPlanEdge {
  return { from, to, fromPort: "value-out", toPort: "event-in" };
}

export const DECISION: AgentPlanDecision = {
  id: "decision",
  type: "decision",
  x: 560,
  y: 0,
};

/**
 * Start → check → decision; true ends the plan, false leads to a fix agent,
 * whose text result returns to the check agent as an event.
 */
export function reviewCyclePlan(): AgentPlanInput {
  return planOf(
    [
      { id: "start", type: "start", x: 0, y: 0 },
      agentNode("check", "codex", { x: 200 }),
      DECISION,
      agentNode("fix", "codex-two", { x: 800, y: 300 }),
      { id: "end", type: "end", x: 1000, y: 0 },
    ],
    [
      flowEdge("start", "check"),
      conditionEdge("check", "decision"),
      branchEdge("decision", "true", "end"),
      branchEdge("decision", "false", "fix"),
      eventEdge("fix", "check"),
    ],
  );
}
