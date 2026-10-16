import { agentRunOptionsFor } from "./AgentConfiguration";
import {
  hasAgentParameterValue,
  isAgentParameterName,
} from "./AgentParameters";
import { planStepTemplate } from "./AgentPlanConfiguration";
import {
  planGroupEdges,
  planGroupEntries,
  planGroupOrder,
  planGroupRefusal,
} from "./AgentPlanGroup";
import { hasPlanPath } from "./AgentPlanPath";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type {
  AgentPlanInput,
  AgentPlanBinding,
  AgentPlanNode,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanGroupParameter } from "./AgentPlanGroup";
import type { AgentPlanGroup } from "./AgentPlanGroup";
import type { AgentPlanIssue } from "./AgentPlanGraph";
import type { AgentParameterType } from "./AgentParameters";

function sourceType(
  node: AgentPlanNode | undefined,
): AgentParameterType | null {
  if (node?.type === "task") return "ticket";
  if (node?.type === "parameter") return node.value.type;
  return node?.type === "variable" ? "text" : null;
}

function fitsBoundary(
  binding: AgentPlanBinding,
  type: AgentParameterType,
  plan: AgentPlanInput,
): boolean {
  if (binding.kind === "literal")
    return binding.value === null || binding.value.type === type;
  if (binding.kind === "result") return false;
  return (
    sourceType(plan.nodes.find((node) => node.id === binding.nodeId)) === type
  );
}

function hasBoundaryValue(
  binding: AgentPlanBinding | undefined,
  plan: AgentPlanInput,
): boolean {
  if (binding?.kind === "literal") return hasAgentParameterValue(binding.value);
  if (binding?.kind !== "source") return false;
  const source = plan.nodes.find((node) => node.id === binding.nodeId);
  if (source?.type === "parameter") return hasAgentParameterValue(source.value);
  if (source?.type === "variable")
    return Boolean(plan.globals[source.name]?.trim());
  return source?.type === "task";
}

function boundaryIssues(
  group: AgentPlanGroup,
  plan: AgentPlanInput,
  isExecution: boolean,
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const port of group.parameters) {
    if (
      !isAgentParameterName(port.name) ||
      names.has(port.name) ||
      ids.has(port.id)
    )
      issues.push({ nodeId: group.id, port: port.name, reason: "name" });
    names.add(port.name);
    ids.add(port.id);
    const binding = group.bindings[port.name];
    if (
      (binding && !fitsBoundary(binding, port.type, plan)) ||
      (port.defaultValue && port.defaultValue.type !== port.type)
    )
      issues.push({ nodeId: group.id, port: port.name, reason: "type" });
    if (isExecution && isMissingBoundaryValue(port, binding, plan))
      issues.push({ nodeId: group.id, port: port.name, reason: "required" });
  }
  for (const name of Object.keys(group.bindings))
    if (!names.has(name))
      issues.push({ nodeId: group.id, port: name, reason: "port" });
  return issues;
}

/** Where a member's input may come from: a boundary port, a value node outside or a result. */
function memberBindingIssue(
  group: AgentPlanGroup,
  step: AgentPlanStep,
  plan: AgentPlanInput,
  binding: AgentPlanBinding,
): "source" | null {
  if (binding.kind === "literal") return null;
  if (binding.kind === "result") {
    // A member's result needs an internal path; an outer agent's is checked in the expanded plan.
    if (group.steps.some((entry) => entry.id === binding.stepId))
      return hasPlanPath(planGroupEdges(group), binding.stepId, step.id)
        ? null
        : "source";
    return plan.nodes.some(
      (node) => node.id === binding.stepId && node.type === "agent",
    )
      ? null
      : "source";
  }
  if (group.parameters.some((port) => port.id === binding.nodeId)) return null;
  // Value nodes outside the frame feed members directly; their type is checked in the expanded plan.
  return plan.nodes.some(
    (node) =>
      node.id === binding.nodeId &&
      (node.type === "parameter" ||
        node.type === "variable" ||
        node.type === "task"),
  )
    ? null
    : "source";
}

function internalIssues(
  group: AgentPlanGroup,
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  for (const step of group.steps) {
    const template = planStepTemplate(step, agents);
    const refusal = planGroupRefusal(group, step, agents);
    // A node without an agent is reported by the agent check instead.
    if (refusal === "notAcp" || refusal === "otherAdapter")
      issues.push({
        nodeId: step.id,
        port: "provider/adapter",
        reason: "groupProvider",
      });
    for (const [name, binding] of Object.entries(step.bindings)) {
      const reason = memberBindingIssue(group, step, plan, binding);
      if (reason) {
        issues.push({ nodeId: step.id, port: name, reason });
        continue;
      }
      const port =
        binding.kind === "source"
          ? group.parameters.find((entry) => entry.id === binding.nodeId)
          : undefined;
      const parameter = template?.parameters.find(
        (entry) => entry.name === name,
      );
      if (port && parameter?.type !== port.type)
        issues.push({ nodeId: step.id, port: name, reason: "type" });
    }
  }
  return issues;
}

/** Internal edges join two members of the same frame, once, without a cycle. */
function internalEdgeIssues(group: AgentPlanGroup): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const members = new Set(group.steps.map((step) => step.id));
  const edges = planGroupEdges(group);
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!members.has(edge.from) || !members.has(edge.to)) {
      issues.push({
        nodeId: members.has(edge.from) ? edge.to : edge.from,
        port: members.has(edge.from) ? "flow-in" : "flow-out",
        reason: "groupBoundary",
      });
      continue;
    }
    if (edge.fromPort !== "flow-out" || edge.toPort !== "flow-in")
      issues.push({ nodeId: edge.to, port: edge.toPort, reason: "port" });
    const key = JSON.stringify([edge.from, edge.to]);
    if (seen.has(key))
      issues.push({ nodeId: edge.to, port: "flow-in", reason: "duplicate" });
    seen.add(key);
    if (edge.from === edge.to || hasPlanPath(edges, edge.to, edge.from))
      issues.push({ nodeId: edge.from, port: "flow-out", reason: "cycle" });
  }
  return issues;
}

/**
 * A shared session runs one turn after another, so a runnable group is one chain.
 *
 * @remarks
 * Each member that branches, joins or starts a second chain is named, so the
 * editor can show which connection to set or remove.
 */
function orderIssues(group: AgentPlanGroup): AgentPlanIssue[] {
  if (group.steps.length === 0 || planGroupOrder(group)) return [];
  const edges = planGroupEdges(group);
  const entries = planGroupEntries(group);
  const issues: AgentPlanIssue[] = [];
  for (const step of group.steps) {
    const incoming = edges.filter((edge) => edge.to === step.id).length;
    const outgoing = edges.filter((edge) => edge.from === step.id).length;
    if (incoming > 1 || (incoming === 0 && entries.length > 1))
      issues.push({ nodeId: step.id, port: "flow-in", reason: "groupOrder" });
    if (outgoing > 1)
      issues.push({ nodeId: step.id, port: "flow-out", reason: "groupOrder" });
  }
  return issues.length > 0
    ? issues
    : [{ nodeId: group.id, port: null, reason: "groupOrder" }];
}

function configurationIssues(
  group: AgentPlanGroup,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  let expected: Readonly<Record<string, unknown>> | null = null;
  for (const step of group.steps) {
    const configuration = step.configuration;
    const source = agents.find((entry) => entry.id === step.agentId);
    const provider = configuration?.provider ?? source?.provider;
    if (!provider) continue;
    const options = agentRunOptionsFor(
      provider,
      planStepTemplate(step, agents)?.run,
    );
    const fields = {
      "provider/adapter": provider,
      model: configuration?.model ?? source?.model,
      reasoningEffort: configuration
        ? configuration.reasoningEffort
        : source?.reasoningEffort,
      access: options.access,
      shell: options.shell,
      web: options.web,
    };
    if (expected) {
      const previous = expected;
      const conflict = Object.entries(fields).find(
        ([field, setting]) => setting !== previous[field],
      );
      if (conflict)
        issues.push({
          nodeId: step.id,
          port: conflict[0],
          reason: "groupConfiguration",
        });
    }
    expected = fields;
  }
  return issues;
}

/** Validates explicit boundary contracts before expanding them into execution nodes. */
export function planGroupIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
  isExecution: boolean,
): readonly AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const ids = new Set(plan.nodes.map((node) => node.id));
  for (const node of plan.nodes) {
    if (node.type !== "group") continue;
    // A neutral group may be saved empty; it needs one agent before it runs.
    if (isExecution && node.steps.length === 0)
      issues.push({ nodeId: node.id, port: null, reason: "groupSize" });
    for (const step of node.steps) {
      if (ids.has(step.id))
        issues.push({ nodeId: step.id, port: null, reason: "duplicateNode" });
      ids.add(step.id);
    }
    issues.push(
      ...boundaryIssues(node, plan, isExecution),
      ...internalIssues(node, plan, agents),
      ...internalEdgeIssues(node),
      ...configurationIssues(node, agents),
      ...(isExecution ? orderIssues(node) : []),
    );
  }
  return issues;
}

function isMissingBoundaryValue(
  port: AgentPlanGroupParameter,
  binding: AgentPlanBinding | undefined,
  plan: AgentPlanInput,
): boolean {
  if (!port.isRequired || hasBoundaryValue(binding, plan)) return false;
  return !(binding === undefined && hasAgentParameterValue(port.defaultValue));
}
