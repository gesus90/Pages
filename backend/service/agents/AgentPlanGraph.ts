import { AgentError } from "@/backend/error/AgentErrors";

import type {
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanStep,
} from "@/definition/AgentPlan";

/** Finds execution nodes without confusing data sources with runnable steps. */
export function planSteps(plan: AgentPlanInput): readonly AgentPlanStep[] {
  return plan.nodes.filter(
    (node): node is AgentPlanStep => node.type === "agent",
  );
}

/** Tests transitive ordering for joins, result references and workspace conflict checks. */
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

/** Rejects cycles, duplicate edges, dangling ports and result references without dependency paths. */
export function validatePlanGraph(plan: AgentPlanInput): void {
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  if (nodes.size !== plan.nodes.length) throw new AgentError("plan_invalid");
  const edges = new Set<string>();
  for (const edge of plan.edges) {
    if (
      nodes.get(edge.from)?.type !== "agent" ||
      nodes.get(edge.to)?.type !== "agent" ||
      edges.has(`${edge.from}:${edge.to}`)
    )
      throw new AgentError("plan_invalid");
    edges.add(`${edge.from}:${edge.to}`);
    if (edge.from === edge.to || hasPlanPath(plan.edges, edge.to, edge.from))
      throw new AgentError("plan_cycle");
  }
  for (const step of planSteps(plan)) validateBindings(step, plan);
  if (
    plan.nodes.some(
      (node) =>
        node.type === "variable" && !Object.hasOwn(plan.globals, node.name),
    )
  )
    throw new AgentError("plan_binding_invalid");
}

function validateBindings(step: AgentPlanStep, plan: AgentPlanInput): void {
  for (const binding of Object.values(step.bindings)) {
    if (binding.kind === "source") {
      const node = plan.nodes.find((entry) => entry.id === binding.nodeId);
      if (!node || node.type === "agent")
        throw new AgentError("plan_binding_invalid");
    }
    if (
      binding.kind === "result" &&
      !hasPlanPath(plan.edges, binding.stepId, step.id)
    )
      throw new AgentError("plan_binding_invalid");
  }
}
