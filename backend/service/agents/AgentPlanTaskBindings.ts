import { expandPlanGroups } from "@/definition/AgentPlanGroup";

import { planSteps } from "./AgentPlanGraph";

import type { AgentPlan } from "@/definition/AgentPlan";

/** An agent and a ticket that a plan step binds to it. */
export interface PlanTaskBinding {
  readonly agentId: string;
  readonly taskId: string;
}

/**
 * Lists each agent and ticket pair once per plan, including a step's personal access agent.
 *
 * @param plan - A stored plan; its groups count with their members.
 */
export function planTaskBindings(plan: AgentPlan): readonly PlanTaskBinding[] {
  plan = expandPlanGroups(plan);
  const tickets = new Map<string, string>();
  for (const node of plan.nodes)
    if (node.type === "task") tickets.set(node.id, node.taskId);
  const pairs = new Map<string, PlanTaskBinding>();
  for (const step of planSteps(plan)) {
    const agentIds =
      step.personalAgentId === null
        ? [step.agentId]
        : [step.agentId, step.personalAgentId];
    for (const binding of Object.values(step.bindings)) {
      const taskId =
        binding.kind === "source" ? tickets.get(binding.nodeId) : undefined;
      if (taskId === undefined) continue;
      for (const agentId of agentIds)
        pairs.set(`${agentId}\n${taskId}`, { agentId, taskId });
    }
  }
  return [...pairs.values()];
}
