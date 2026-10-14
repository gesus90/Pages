import {
  hasAgentParameterValue,
  isAgentParameterName,
} from "./AgentParameters";
import { planValueIssue } from "./AgentPlanValue";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentParameter } from "./AgentParameters";
import type {
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
  AgentPlanBinding,
} from "./AgentPlan";

/** A stable port reference lets the editor and server explain the same invalid connection. */
export interface AgentPlanIssue {
  readonly nodeId: string | null;
  readonly port: string | null;
  readonly reason:
    | "duplicateNode"
    | "port"
    | "duplicate"
    | "cycle"
    | "type"
    | "source"
    | "required"
    | "start"
    | "end"
    | "flowIn"
    | "flowOut"
    | "unreachable"
    | "agent"
    | "name"
    | "json"
    | "number";
}

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

/** Tickets used exclusively as input stay outside the execution graph. */
export function isPlanFlowNode(
  node: AgentPlanNode,
  plan: AgentPlanInput,
): boolean {
  if (node.type === "parameter" || node.type === "variable") return false;
  if (
    node.type !== "task" ||
    plan.edges.some((edge) => edge.from === node.id || edge.to === node.id)
  )
    return true;
  return !plan.nodes.some(
    (step) =>
      step.type === "agent" &&
      Object.values(step.bindings).some(
        (binding) => binding.kind === "source" && binding.nodeId === node.id,
      ),
  );
}

/** Data sources use the established agent types; ticket markdown fits a text input. */
export function planSourceType(
  node: AgentPlanNode | undefined,
): AgentParameter["type"] | null {
  if (node?.type === "parameter") return node.value.type;
  if (node?.type === "variable" || node?.type === "task") return "text";
  return null;
}

function edgeIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const seen = new Set<string>();
  for (const edge of plan.edges) {
    const source = plan.nodes.find((node) => node.id === edge.from);
    const target = plan.nodes.find((node) => node.id === edge.to);
    const validSource =
      source && ["start", "agent", "task"].includes(source.type);
    const validTarget =
      target && ["end", "agent", "task"].includes(target.type);
    if (!validSource || edge.fromPort !== "flow-out")
      issues.push({ nodeId: edge.from, port: edge.fromPort, reason: "port" });
    if (!validTarget || edge.toPort !== "flow-in")
      issues.push({ nodeId: edge.to, port: edge.toPort, reason: "port" });
    const key = JSON.stringify([edge.from, edge.to]);
    if (seen.has(key))
      issues.push({ nodeId: edge.to, port: "flow-in", reason: "duplicate" });
    seen.add(key);
    if (edge.from === edge.to || hasPlanPath(plan.edges, edge.to, edge.from))
      issues.push({ nodeId: edge.from, port: "flow-out", reason: "cycle" });
  }
  return issues;
}

function bindingIssues(
  step: AgentPlanStep,
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const agent = agents.find((entry) => entry.id === step.agentId);
  if (!agent) return [{ nodeId: step.id, port: null, reason: "agent" }];
  for (const [name, binding] of Object.entries(step.bindings)) {
    const parameter = agent.configuration.parameters.find(
      (entry) => entry.name === name,
    );
    let type: AgentParameter["type"] | null = null;
    if (binding.kind === "literal") type = binding.value?.type ?? null;
    if (binding.kind === "source")
      type = planSourceType(
        plan.nodes.find((node) => node.id === binding.nodeId),
      );
    if (
      binding.kind === "result" &&
      plan.nodes.some(
        (node) => node.id === binding.stepId && node.type === "agent",
      ) &&
      hasPlanPath(plan.edges, binding.stepId, step.id)
    )
      type = "text";
    if (!parameter)
      issues.push({ nodeId: step.id, port: name, reason: "port" });
    else if (
      type !== parameter.type &&
      !(binding.kind === "literal" && binding.value === null)
    )
      issues.push({ nodeId: step.id, port: name, reason: "type" });
  }
  return issues;
}

/** Structural checks apply to drafts too; missing connections are checked before Play. */
export function planConnectionIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentPlanIssue[] {
  const issues = edgeIssues(plan);
  if (new Set(plan.nodes.map((node) => node.id)).size !== plan.nodes.length)
    issues.push({ nodeId: null, port: null, reason: "duplicateNode" });
  for (const node of plan.nodes) {
    if (node.type === "parameter") {
      if (!isAgentParameterName(node.name))
        issues.push({ nodeId: node.id, port: "value-out", reason: "name" });
      const reason = planValueIssue(node);
      if (reason) issues.push({ nodeId: node.id, port: "value-out", reason });
    }
    if (node.type === "agent")
      issues.push(...bindingIssues(node, plan, agents));
    if (node.type === "variable" && !Object.hasOwn(plan.globals, node.name))
      issues.push({ nodeId: node.id, port: "value-out", reason: "source" });
  }
  return issues;
}

function requiredParameterIssues(
  step: AgentPlanStep,
  agent: AgentDefinitionChoice | undefined,
  plan: AgentPlanInput,
): AgentPlanIssue[] {
  if (!agent?.availability.isUsable)
    return [{ nodeId: step.id, port: null, reason: "agent" }];
  return agent.configuration.parameters.flatMap(
    (parameter): AgentPlanIssue[] => {
      if (
        !parameter.isRequired &&
        parameter.name !== agent.configuration.directoryParameter
      )
        return [];
      const binding = step.bindings[parameter.name];
      if (!binding && hasAgentParameterValue(parameter.defaultValue)) return [];
      if (binding?.kind === "literal" && hasAgentParameterValue(binding.value))
        return [];
      if (hasConnectedValue(binding, plan)) return [];
      return [{ nodeId: step.id, port: parameter.name, reason: "required" }];
    },
  );
}

function hasConnectedValue(
  binding: AgentPlanBinding | undefined,
  plan: AgentPlanInput,
): boolean {
  if (binding?.kind === "result") return true;
  if (binding?.kind !== "source") return false;
  const source = plan.nodes.find((node) => node.id === binding.nodeId);
  if (source?.type === "task") return true;
  if (source?.type === "variable")
    return Boolean(plan.globals[source.name]?.trim());
  if (source?.type !== "parameter") return false;
  return hasAgentParameterValue(source.value);
}

/** A runnable DAG has explicit boundaries and no unreachable or unfinished flow branch. */
export function planExecutionIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentPlanIssue[] {
  const issues = [...planConnectionIssues(plan, agents)];
  const starts = plan.nodes.filter((node) => node.type === "start");
  const ends = plan.nodes.filter((node) => node.type === "end");
  if (starts.length === 0)
    issues.push({ nodeId: null, port: null, reason: "start" });
  if (ends.length === 0)
    issues.push({ nodeId: null, port: null, reason: "end" });
  if (!plan.nodes.some((node) => node.type === "agent"))
    issues.push({ nodeId: null, port: null, reason: "agent" });
  for (const node of plan.nodes.filter((entry) =>
    isPlanFlowNode(entry, plan),
  )) {
    if (
      node.type !== "start" &&
      !plan.edges.some((edge) => edge.to === node.id)
    )
      issues.push({ nodeId: node.id, port: "flow-in", reason: "flowIn" });
    if (
      node.type !== "end" &&
      !plan.edges.some((edge) => edge.from === node.id)
    )
      issues.push({ nodeId: node.id, port: "flow-out", reason: "flowOut" });
    if (
      node.type !== "start" &&
      !starts.some((start) => hasPlanPath(plan.edges, start.id, node.id))
    )
      issues.push({ nodeId: node.id, port: "flow-in", reason: "unreachable" });
    if (
      node.type !== "end" &&
      !ends.some((end) => hasPlanPath(plan.edges, node.id, end.id))
    )
      issues.push({ nodeId: node.id, port: "flow-out", reason: "end" });
    if (node.type === "agent")
      issues.push(
        ...requiredParameterIssues(
          node,
          agents.find((agent) => agent.id === node.agentId),
          plan,
        ),
      );
  }
  return issues;
}
