import type { AgentPlanInput, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** Lists executable nodes, including the members of groups and loops. */
export function planExecutionNodes(
  plan: AgentPlanInput,
): readonly (AgentPlanStep | AgentPlanScript)[] {
  return plan.nodes.flatMap<AgentPlanStep | AgentPlanScript>((node) => {
    if (node.type === "agent" || node.type === "script") return [node];
    if (node.type === "group" || node.type === "loop") return node.steps;
    return [];
  });
}

/** Remote drafts stay editable while their execution requires a remote dispatcher. */
export function hasRemotePlanTarget(plan: AgentPlanInput): boolean {
  return planExecutionNodes(plan).some(
    (node) => node.executionTarget?.kind === "remote",
  );
}
