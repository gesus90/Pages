import { agentRunOptionsFor } from "./AgentConfiguration";
import {
  hasAgentParameterValue,
  isAgentParameterName,
} from "./AgentParameters";
import { planStepTemplate } from "./AgentPlanConfiguration";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type {
  AgentPlanInput,
  AgentPlanBinding,
  AgentPlanNode,
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

function internalIssues(
  group: AgentPlanGroup,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  group.steps.forEach((step, index) => {
    const template = planStepTemplate(step, agents);
    const configuration = step.configuration;
    const source = agents.find((entry) => entry.id === step.agentId);
    if ((configuration?.provider ?? source?.provider) !== "codex_cli")
      issues.push({
        nodeId: step.id,
        port: "provider/adapter",
        reason: "groupProvider",
      });
    for (const [name, binding] of Object.entries(step.bindings)) {
      const parameter = template?.parameters.find(
        (entry) => entry.name === name,
      );
      if (binding.kind === "literal") continue;
      if (binding.kind === "result") {
        if (
          !group.steps
            .slice(0, index)
            .some((entry) => entry.id === binding.stepId)
        )
          issues.push({ nodeId: step.id, port: name, reason: "source" });
        continue;
      }
      const port = group.parameters.find(
        (entry) => entry.id === binding.nodeId,
      );
      if (!port) issues.push({ nodeId: step.id, port: name, reason: "source" });
      else if (parameter?.type !== port.type)
        issues.push({ nodeId: step.id, port: name, reason: "type" });
    }
  });
  return issues;
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
    if (isExecution && node.steps.length < 2)
      issues.push({ nodeId: node.id, port: null, reason: "groupSize" });
    for (const step of node.steps) {
      if (ids.has(step.id))
        issues.push({ nodeId: step.id, port: null, reason: "duplicateNode" });
      ids.add(step.id);
    }
    issues.push(
      ...boundaryIssues(node, plan, isExecution),
      ...internalIssues(node, agents),
      ...configurationIssues(node, agents),
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
