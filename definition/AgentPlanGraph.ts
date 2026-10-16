import {
  allPlanSteps,
  expandPlanGroups,
  planGroupEdges,
} from "./AgentPlanGroup";
import { planGroupIssues } from "./AgentPlanGroupGraph";
import {
  hasAgentParameterValue,
  isAgentParameterName,
  scanAgentPlaceholders,
} from "./AgentParameters";
import { planStepTemplate } from "./AgentPlanConfiguration";
import { planValueIssue } from "./AgentPlanValue";
import { hasPlanPath } from "./AgentPlanPath";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentParameter } from "./AgentParameters";
import type { AgentPlanGroup } from "./AgentPlanGroup";
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
    | "groupSize"
    | "groupProvider"
    | "groupConfiguration"
    | "groupOrder"
    | "groupBoundary"
    | "unsupportedRunNotes"
    | "duplicateNode"
    | "port"
    | "duplicate"
    | "cycle"
    | "type"
    | "ticketHandoff"
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

export { hasPlanPath } from "./AgentPlanPath";

/** Start, end and agent nodes form the execution graph; tickets, parameters and variables only supply values. */
export function isPlanFlowNode(node: AgentPlanNode): boolean {
  return (
    node.type === "start" ||
    node.type === "end" ||
    node.type === "agent" ||
    node.type === "group"
  );
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

/**
 * Removing a node also removes its flow and parameter references.
 *
 * @remarks
 * The node may be a member of a group; the group then loses the member and
 * its internal edges. Removing a group removes its members with it, together
 * with every reference to them; keeping the members is
 * {@link ungroupPlanGroup}'s work, never a silent fallback.
 */
export function removePlanNode<Plan extends AgentPlanInput>(
  draft: Plan,
  id: string,
): Plan {
  const group = draft.nodes.find((node) => node.id === id);
  const removed = new Set([
    id,
    ...(group?.type === "group" ? group.steps.map((step) => step.id) : []),
  ]);
  function withoutReferences<Node extends AgentPlanStep | AgentPlanGroup>(
    node: Node,
  ): Node {
    const bindings = Object.fromEntries(
      Object.entries(node.bindings).filter(
        ([, binding]) =>
          !(binding.kind === "source" && removed.has(binding.nodeId)) &&
          !(binding.kind === "result" && removed.has(binding.stepId)),
      ),
    );
    return { ...node, bindings };
  }
  return {
    ...draft,
    nodes: draft.nodes
      .filter((node) => node.id !== id)
      .map((node) => {
        if (node.type === "agent") return withoutReferences(node);
        if (node.type !== "group") return node;
        const steps = node.steps
          .filter((step) => step.id !== id)
          .map(withoutReferences);
        const hasMember = steps.length !== node.steps.length;
        return {
          ...withoutReferences(node),
          steps,
          ...(hasMember
            ? {
                edges: planGroupEdges(node).filter(
                  (edge) => edge.from !== id && edge.to !== id,
                ),
              }
            : {}),
        };
      }),
    edges: draft.edges.filter(
      (edge) => !removed.has(edge.from) && !removed.has(edge.to),
    ),
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
  const top = new Set(plan.nodes.map((node) => node.id));
  // An outer edge that reaches into a frame should end at the frame's own flow port.
  const members = new Set(
    allPlanSteps(plan)
      .map((step) => step.id)
      .filter((id) => !top.has(id)),
  );
  for (const edge of plan.edges) {
    const source = plan.nodes.find((node) => node.id === edge.from);
    const target = plan.nodes.find((node) => node.id === edge.to);
    const validSource =
      source && ["start", "agent", "group"].includes(source.type);
    const validTarget =
      target && ["end", "agent", "group"].includes(target.type);
    if (!validSource || edge.fromPort !== "flow-out")
      issues.push({
        nodeId: edge.from,
        port: edge.fromPort,
        reason: members.has(edge.from) ? "groupBoundary" : "port",
      });
    if (!validTarget || edge.toPort !== "flow-in")
      issues.push({
        nodeId: edge.to,
        port: edge.toPort,
        reason: members.has(edge.to) ? "groupBoundary" : "port",
      });
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
    const parameter = planStepTemplate(step, agents)?.parameters.find(
      (entry) => entry.name === name,
    );
    if (!parameter)
      issues.push({ nodeId: step.id, port: name, reason: "port" });
    else if (binding.kind === "result" && parameter.type === "ticket")
      issues.push({ nodeId: step.id, port: name, reason: "ticketHandoff" });
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
  const issues = [...edgeIssues(plan), ...planGroupIssues(plan, agents, false)];
  // Every agent, members included, is checked where results can cross a frame.
  const expanded = expandPlanGroups(plan);
  for (const node of expanded.nodes)
    if (node.type === "agent")
      issues.push(...bindingIssues(node, expanded, agents));
  if (new Set(plan.nodes.map((node) => node.id)).size !== plan.nodes.length)
    issues.push({ nodeId: null, port: null, reason: "duplicateNode" });
  for (const node of plan.nodes) {
    if (node.type === "parameter") {
      if (!isAgentParameterName(node.name))
        issues.push({ nodeId: node.id, port: "value-out", reason: "name" });
      const reason = planValueIssue(node);
      if (reason) issues.push({ nodeId: node.id, port: "value-out", reason });
    }
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
  const configuration = step.configuration?.template ?? agent?.configuration;
  if (
    [configuration?.markdown ?? "", step.instruction].some(
      (markdown) => scanAgentPlaceholders(markdown).hasUnsupportedRunNotes,
    )
  )
    return [{ nodeId: step.id, port: null, reason: "unsupportedRunNotes" }];
  if (
    !agent ||
    (!step.configuration && !agent.availability.isUsable) ||
    step.personalAgentId === ""
  )
    return [{ nodeId: step.id, port: null, reason: "agent" }];
  return (configuration?.parameters ?? []).flatMap(
    (parameter): AgentPlanIssue[] => {
      if (
        !parameter.isRequired &&
        parameter.name !== configuration?.directoryParameter
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
  if (plan.nodes.some((node) => node.type === "group")) {
    return [
      ...planConnectionIssues(plan, agents),
      ...planGroupIssues(plan, agents, true),
      ...planExecutionIssues(expandPlanGroups(plan), agents),
    ];
  }
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
