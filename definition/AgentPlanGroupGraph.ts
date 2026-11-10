import { hasPlanPath } from "./AgentPlanPath";
import { agentRunOptionsFor } from "./AgentConfiguration";
import { planStepTemplate } from "./AgentPlanConfiguration";
import { planGroupEdges, planGroupRefusal } from "./AgentPlanGroup";
import { planEdgeKind } from "./AgentPlanBranching";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentPlanEdge, AgentPlanInput } from "./AgentPlan";
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
  return containerEdgeIssues(
    new Set([
      ...group.steps.map((step) => step.id),
      ...(group.decisions ?? []).map((decision) => decision.id),
    ]),
    planGroupEdges(group),
  );
}

/**
 * The checks of the internal edges of a group or a loop.
 *
 * @param members - The IDs of the members of the container.
 * @param edges - Its internal edges.
 *
 * @remarks
 * Besides flow edges, a decision inside the container keeps its condition and
 * branch edges here (PAGE-286); an event edge never joins two members.
 */
export function containerEdgeIssues(
  members: ReadonlySet<string>,
  edges: readonly AgentPlanEdge[],
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
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
    const kind = planEdgeKind(edge);
    if (kind !== "flow" && kind !== "branch" && kind !== "condition")
      issues.push({ nodeId: edge.to, port: edge.toPort, reason: "port" });
    const key = JSON.stringify([edge.from, edge.to, edge.fromPort]);
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

/** The groups of a plan, those inside loops included. */
function allGroups(plan: AgentPlanInput): readonly AgentPlanGroup[] {
  return plan.nodes.flatMap((node) => {
    if (node.type === "group") return [node];
    return node.type === "loop"
      ? node.steps.filter((step) => step.type === "group")
      : [];
  });
}

/** Validates explicit boundary contracts before expanding them into execution nodes. */
export function planGroupIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
  isExecution: boolean,
): readonly AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const ids = new Set(plan.nodes.map((node) => node.id));
  const loopEdges = plan.nodes.flatMap((node) =>
    node.type === "loop" ? node.edges : [],
  );
  for (const node of allGroups(plan)) {
    // A neutral group may be saved empty; it needs one agent before it runs.
    if (isExecution && node.steps.length === 0)
      issues.push({ nodeId: node.id, port: null, reason: "groupSize" });
    for (const step of [...node.steps, ...(node.decisions ?? [])]) {
      if (ids.has(step.id))
        issues.push({ nodeId: step.id, port: null, reason: "duplicateNode" });
      ids.add(step.id);
    }
    for (const edge of [...plan.edges, ...loopEdges])
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
