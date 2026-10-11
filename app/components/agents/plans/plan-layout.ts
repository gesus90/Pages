import type { AgentPlanNode, AgentPlanSources } from "@/definition/AgentPlan";

export const PLAN_GRID = 20;
export const PLAN_NODE_WIDTH = 280;

/** Shared geometry keeps rendered cards and SVG ports aligned. */
export function planNodeHeight(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): number {
  if (node.type !== "agent") return 140;
  const agent = sources.agents.find((entry) => entry.id === node.agentId);
  return 168 + (agent?.configuration.parameters.length ?? 0) * 32;
}

/** Labels stay readable when a saved resource has become unavailable. */
export function planNodeLabel(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): string {
  if (node.type === "variable") return node.name;
  if (node.type === "task") {
    const task = sources.tasks.find((entry) => entry.id === node.taskId);
    return task ? `${task.key}: ${task.title}` : node.taskId;
  }
  return (
    sources.agents.find((entry) => entry.id === node.agentId)?.name ??
    node.agentId
  );
}

/** Uses the existing board data tints with explicit node-type labels. */
export function planNodeClass(type: AgentPlanNode["type"]): string {
  const classes = {
    agent: "bg-column-todo border-info/40",
    task: "bg-column-done border-success/40",
    variable: "bg-column-review border-foreground/20",
  };
  return classes[type];
}
