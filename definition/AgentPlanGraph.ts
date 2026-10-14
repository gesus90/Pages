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

/** Start, end and agent nodes form the execution graph; tickets, parameters and variables only supply values. */
export function isPlanFlowNode(node: AgentPlanNode): boolean {
  return node.type === "start" || node.type === "end" || node.type === "agent";
}

/** Data sources use the established agent types; a ticket node supplies a ticket reference. */
export function planSourceType(
  node: AgentPlanNode | undefined,
): AgentParameter["type"] | null {
  if (node?.type === "parameter") return node.value.type;
  if (node?.type === "variable") return "text";
  if (node?.type === "task") return "ticket";
  return null;
}

/**
 * Tells whether a source node may feed a parameter of the given type.
 *
 * @remarks
 * A ticket node also fits a text parameter and then supplies its markdown, as
 * before ticket parameters existed, so earlier plans keep their bindings.
 */
export function fitsPlanParameter(
  source: AgentPlanNode | undefined,
  parameterType: AgentParameter["type"],
): boolean {
  return (
    planSourceType(source) === parameterType ||
    (source?.type === "task" && parameterType === "text")
  );
}

/**
 * Replaces flow edges through ticket nodes by direct edges between their neighbours.
 *
 * @remarks
 * Ticket nodes were flow checkpoints in earlier plans. They are pure value
 * sources now, so a saved plan keeps its execution order without them.
 */
export function withoutTicketFlow<Plan extends AgentPlanInput>(
  plan: Plan,
): Plan {
  const tickets = new Set(
    plan.nodes.filter((node) => node.type === "task").map((node) => node.id),
  );
  if (
    !plan.edges.some((edge) => tickets.has(edge.from) || tickets.has(edge.to))
  )
    return plan;
  let edges = plan.edges;
  for (const ticket of tickets) edges = bridgeNode(edges, ticket);
  return { ...plan, edges };
}

/** Removing a node also removes its flow and parameter references. */
export function removePlanNode<Plan extends AgentPlanInput>(
  draft: Plan,
  id: string,
): Plan {
  return {
    ...draft,
    nodes: draft.nodes
      .filter((node) => node.id !== id)
      .map((node) => {
        if (node.type !== "agent") return node;
        const bindings = Object.fromEntries(
          Object.entries(node.bindings).filter(
            ([, binding]) =>
              !(binding.kind === "source" && binding.nodeId === id) &&
              !(binding.kind === "result" && binding.stepId === id),
          ),
        );
        return { ...node, bindings };
      }),
    edges: draft.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
}

function bridgeNode(
  edges: readonly AgentPlanEdge[],
  id: string,
): readonly AgentPlanEdge[] {
  const remaining = edges.filter((edge) => edge.from !== id && edge.to !== id);
  for (const before of edges.filter((edge) => edge.to === id))
    for (const after of edges.filter((edge) => edge.from === id))
      if (
        before.from !== after.to &&
        !remaining.some(
          (edge) => edge.from === before.from && edge.to === after.to,
        )
      )
        remaining.push({ ...after, from: before.from });
  return remaining;
}

function edgeIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const seen = new Set<string>();
  for (const edge of plan.edges) {
    const source = plan.nodes.find((node) => node.id === edge.from);
    const target = plan.nodes.find((node) => node.id === edge.to);
    const validSource = source && ["start", "agent"].includes(source.type);
    const validTarget = target && ["end", "agent"].includes(target.type);
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
    if (!parameter)
      issues.push({ nodeId: step.id, port: name, reason: "port" });
    else if (!fitsBinding(step, binding, plan, parameter.type))
      issues.push({ nodeId: step.id, port: name, reason: "type" });
  }
  return issues;
}

function fitsBinding(
  step: AgentPlanStep,
  binding: AgentPlanBinding,
  plan: AgentPlanInput,
  parameterType: AgentParameter["type"],
): boolean {
  if (binding.kind === "literal")
    return binding.value === null || binding.value.type === parameterType;
  if (binding.kind === "source")
    return fitsPlanParameter(
      plan.nodes.find((node) => node.id === binding.nodeId),
      parameterType,
    );
  return (
    parameterType === "text" &&
    plan.nodes.some(
      (node) => node.id === binding.stepId && node.type === "agent",
    ) &&
    hasPlanPath(plan.edges, binding.stepId, step.id)
  );
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
  if (!agent?.availability.isUsable || step.personalAgentId === "")
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
  for (const node of plan.nodes.filter(isPlanFlowNode)) {
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
