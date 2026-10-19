import { hasPlanPath } from "./AgentPlanPath";
import { agentRunOptionsFor } from "./AgentConfiguration";
import { planStepTemplate } from "./AgentPlanConfiguration";
import { planGroupEdges, planGroupRefusal } from "./AgentPlanGroup";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentPlanInput } from "./AgentPlan";
import type { AgentPlanGroup } from "./AgentPlanGroup";
import type { AgentPlanIssue } from "./AgentPlanGraph";

function internalIssues(
  group: AgentPlanGroup,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  for (const step of group.steps) {
    const refusal = planGroupRefusal(group, step, agents);
    if (refusal === "notAcp" || refusal === "otherAdapter")
      issues.push({
        nodeId: step.id,
        port: "provider/adapter",
        reason: "groupProvider",
      });
    for (const [name, binding] of Object.entries(step.bindings))
      if (
        binding.kind === "source" &&
        group.parameters.some((port) => port.id === binding.nodeId)
      )
        issues.push({ nodeId: step.id, port: name, reason: "groupBinding" });
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
    for (const edge of plan.edges)
      if (edge.from === node.id || edge.to === node.id)
        issues.push({
          nodeId: node.id,
          port: edge.to === node.id ? "flow-in" : "flow-out",
          reason: "groupBoundary",
        });
    issues.push(
      ...internalIssues(node, agents),
      ...internalEdgeIssues(node),
      ...configurationIssues(node, agents),
    );
  }
  return issues;
}
