import { planNodeParameters } from "@/definition/AgentPlanGroup";
import { planStepTemplate } from "@/definition/AgentPlanConfiguration";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanSources,
} from "@/definition/AgentPlan";
import type { PlanLink } from "./plan-links";

export const PLAN_GRID = 20;
export const PLAN_NODE_WIDTH = 280;

/** End points of a drawn connection in grid coordinates. */
export interface PlanLinkPoints {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Shared geometry keeps rendered cards and SVG ports aligned. */
export function planNodeHeight(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): number {
  if (node.type === "group") return 140 + node.parameters.length * 32;
  if (node.type !== "agent") return 140;
  return (
    168 + (planStepTemplate(node, sources.agents)?.parameters.length ?? 0) * 32
  );
}

/** Labels stay readable when a saved resource has become unavailable. */
export function planNodeLabel(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): string {
  if (node.type === "start" || node.type === "end") return node.type;
  if (
    node.type === "variable" ||
    node.type === "parameter" ||
    node.type === "group"
  )
    return node.name;
  if (node.type === "task") {
    const task = sources.tasks.find((entry) => entry.id === node.taskId);
    return task ? `${task.key}: ${task.title}` : node.taskId;
  }
  return (
    node.configuration?.name ??
    sources.agents.find((entry) => entry.id === node.agentId)?.name ??
    node.agentId
  );
}

/** Uses the existing board data tints with explicit node-type labels. */
export function planNodeClass(type: AgentPlanNode["type"]): string {
  const classes = {
    agent: "bg-column-todo border-info/40",
    group: "bg-column-todo border-primary",
    task: "bg-column-done border-success/40",
    variable: "bg-column-review border-foreground/20",
    parameter: "bg-column-review border-foreground/20",
    start: "bg-surface border-success",
    end: "bg-surface border-primary",
  };
  return classes[type];
}

/** Port centers share the card geometry so a line always names the port it actually reaches. */
export function planOutputY(
  node: AgentPlanNode,
  sources: AgentPlanSources,
): number {
  if (node.type === "agent")
    return (
      112 +
      (planStepTemplate(node, sources.agents)?.parameters.length ?? 0) * 32
    );
  return 80;
}

/** Flow edges join the flow ports; data links join an OUT with its parameter row. */
export function planLinkPoints(
  plan: AgentPlanInput,
  sources: AgentPlanSources,
  link: PlanLink,
): PlanLinkPoints | null {
  const source = plan.nodes.find((node) => node.id === link.from);
  const target = plan.nodes.find((node) => node.id === link.to);
  if (!source || !target) return null;
  const x1 = source.x + PLAN_NODE_WIDTH;
  const x2 = target.x;
  if (link.kind === "flow")
    return { x1, y1: source.y + 72, x2, y2: target.y + 72 };
  const parameters = planNodeParameters(target, sources.agents);
  const index = parameters.findIndex(
    (parameter) => parameter.name === link.parameter,
  );
  return {
    x1,
    y1: source.y + planOutputY(source, sources),
    x2,
    y2: target.y + 104 + Math.max(0, index) * 32,
  };
}
