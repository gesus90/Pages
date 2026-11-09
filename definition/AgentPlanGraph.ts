import { expandPlanGroups } from "./AgentPlanGroup";
import { withPortlessPlanGroups } from "./AgentPlanGroupUpgrade";
import { planGroupIssues } from "./AgentPlanGroupGraph";
import { planLoopIssues } from "./AgentPlanLoopGraph";
import {
  hasPlanReach,
  planBranchingExecutionIssues,
  planBranchingIssues,
  planEdgeEndpointIssues,
  planEventOrderIssues,
} from "./AgentPlanBranchingGraph";
import { planEdgeKind, planOrderEdges } from "./AgentPlanBranching";
import { expandPlanLoops } from "./AgentPlanLoop";
import {
  hasAgentParameterValue,
  isAgentParameterName,
  placeholderNames,
  scanAgentPlaceholders,
} from "./AgentParameters";
import { planStepTemplate } from "./AgentPlanConfiguration";
import { planValueIssue } from "./AgentPlanValue";
import { hasPlanPath, planPredecessors } from "./AgentPlanPath";
import {
  PLAN_GIT_CLOSEOUT_PARAMETERS,
  PLAN_GIT_CLOSEOUT_TICKET_INPUT,
  planGitCloseoutIssues,
} from "./AgentPlanGitCloseout";
import { planScriptIssues, planScriptParameters } from "./AgentPlanScript";
import { scriptReportGraphIssues } from "./AgentPlanScriptReportGraph";
import {
  fitsPlanStackOutput,
  planBindingNodes,
  planStackIssues,
} from "./AgentPlanStackGraph";
import { PLAN_ASSET_NAME_LENGTH, planAssets } from "./AgentPlanAsset";
import { isPlanStackTriggered } from "./AgentPlanStack";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentParameter } from "./AgentParameters";
import type { AgentPlanGitCloseout } from "./AgentPlanGitCloseout";
import type { AgentPlanScript } from "./AgentPlanScript";
import type { AgentPlanTargetProblem } from "./AgentPlanTarget";
import type {
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
  AgentPlanBinding,
} from "./AgentPlan";

/** A stable port reference lets the editor and server explain the same invalid connection. */
export interface AgentPlanIssue {
  readonly asset?: {
    readonly id: string;
    readonly name: string;
    readonly cause: string;
  };
  readonly nodeId: string | null;
  readonly port: string | null;
  readonly reason:
    | "remoteTicketUnavailable"
    | "remoteWikiUnavailable"
    | "remoteWorkspaceParameter"
    | "remoteAssetRunner"
    | "remoteAssetUnavailable"
    | "remoteAssetType"
    | "remoteAssetsTooLarge"
    | "remotePromptTooLarge"
    | "remoteParameter"
    | AgentPlanTargetProblem
    | "groupSize"
    | "groupProvider"
    | "groupConfiguration"
    | "groupOrder"
    | "groupBoundary"
    | "groupBinding"
    | "loopSize"
    | "loopBoundary"
    | "loopRuns"
    | "loopCondition"
    | "loopPrevious"
    | "loopProvider"
    | "decisionCondition"
    | "decisionBranch"
    | "eventOrder"
    | "eventFanout"
    | "eventNesting"
    | "branchBoundary"
    | "branchProvider"
    | "branchRemote"
    | "branchGate"
    | "stackScope"
    | "stackOrder"
    | "stackEntries"
    | "stackRemote"
    | "assetFile"
    | "assetUnreadable"
    | "loopWhile"
    | "loopNested"
    | "unsupportedRunNotes"
    | "duplicateNode"
    | "port"
    | "duplicate"
    | "cycle"
    | "type"
    | "ticketHandoff"
    | "resultSource"
    | "resultOrder"
    | "resultMissing"
    | "resultAmbiguous"
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
    | "number"
    | "scriptConfiguration"
    | "scriptReportTarget"
    | "scriptReportGate"
    | "loopScriptUnsupported"
    | "scriptUnavailable"
    | "gitCloseoutConfiguration"
    | "gitCloseoutRemote";
}

export { hasPlanPath } from "./AgentPlanPath";
export { removePlanNode } from "./AgentPlanRemoval";

/** Start, end, agent, script, decision, loop and stack nodes form the execution graph; tickets, parameters and variables only supply values. */
export function isPlanFlowNode(node: AgentPlanNode): boolean {
  return (
    node.type === "start" ||
    node.type === "end" ||
    node.type === "agent" ||
    node.type === "script" ||
    node.type === "git_closeout" ||
    node.type === "decision" ||
    node.type === "loop" ||
    node.type === "stack"
  );
}

/** Agents, scripts and the Git closeout hand their result on through their result port. */
export function isPlanResultNode(
  node: AgentPlanNode | undefined,
): node is AgentPlanStep | AgentPlanScript | AgentPlanGitCloseout {
  return (
    node?.type === "agent" ||
    node?.type === "git_closeout" ||
    (node?.type === "script" && node.outputs.length === 1)
  );
}

/** Data sources use the established agent types; a ticket node supplies a ticket reference. */
export function planSourceType(
  node: AgentPlanNode | undefined,
): AgentParameter["type"] | null {
  if (node?.type === "parameter") return node.value.type;
  if (node?.type === "variable") return "text";
  if (node?.type === "task") return "ticket";
  if (node?.type === "asset") return "asset";
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
    issues.push(...planEdgeEndpointIssues(plan, edge));
    const key = JSON.stringify([edge.from, edge.to]);
    if (seen.has(key))
      issues.push({ nodeId: edge.to, port: edge.toPort, reason: "duplicate" });
    seen.add(key);
    // An event returns to a node that ran before and orders nothing, so only it may close a cycle.
    if (planEdgeKind(edge) === "event") {
      issues.push(...planEventOrderIssues(plan, edge));
      continue;
    }
    if (edge.from === edge.to || hasPlanPath(plan.edges, edge.to, edge.from))
      issues.push({ nodeId: edge.from, port: edge.fromPort, reason: "cycle" });
  }
  return issues;
}

/** The inputs of an agent's template or a script's declaration. */
function inputParameters(
  step: AgentPlanStep | AgentPlanScript | AgentPlanGitCloseout,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentParameter[] {
  if (step.type === "git_closeout") return PLAN_GIT_CLOSEOUT_PARAMETERS;
  if (step.type === "script") return planScriptParameters(step);
  return planStepTemplate(step, agents)?.parameters ?? [];
}

function bindingIssues(
  step: AgentPlanStep | AgentPlanScript | AgentPlanGitCloseout,
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  if (
    step.type === "agent" &&
    !step.configuration &&
    !agents.some((entry) => entry.id === step.agentId)
  )
    return [{ nodeId: step.id, port: null, reason: "agent" }];
  const parameters = inputParameters(step, agents);
  for (const [name, binding] of Object.entries(step.bindings)) {
    const parameter = parameters.find((entry) => entry.name === name);
    if (!parameter)
      issues.push({ nodeId: step.id, port: name, reason: "port" });
    // A previous iteration's result is checked with the loop that owns the member.
    else if (binding.kind === "previous") continue;
    else if (binding.kind === "stack") {
      const stack = plan.nodes.find((node) => node.id === binding.stackId);
      if (!fitsPlanStackOutput(stack, binding.output, parameter.type))
        issues.push({ nodeId: step.id, port: name, reason: "type" });
    } else if (binding.kind === "result" && parameter.type === "ticket")
      issues.push({ nodeId: step.id, port: name, reason: "ticketHandoff" });
    else if (binding.kind === "result" && parameter.type === "text") {
      const reason = resultIssue(step, binding.stepId, plan);
      if (reason) issues.push({ nodeId: step.id, port: name, reason });
    } else if (!fitsBinding(step, binding, plan, parameter.type))
      issues.push({ nodeId: step.id, port: name, reason: "type" });
  }
  return issues;
}

/** Why a result binding of a text input cannot deliver, or `null` when it can. */
function resultIssue(
  step: AgentPlanStep | AgentPlanScript | AgentPlanGitCloseout,
  sourceId: string,
  plan: AgentPlanInput,
): "resultSource" | "resultOrder" | null {
  if (!isPlanResultNode(plan.nodes.find((node) => node.id === sourceId)))
    return "resultSource";
  return hasPlanPath(plan.edges, sourceId, step.id) ? null : "resultOrder";
}

function fitsBinding(
  step: AgentPlanStep | AgentPlanScript | AgentPlanGitCloseout,
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
  if (binding.kind === "stack")
    return fitsPlanStackOutput(
      plan.nodes.find((node) => node.id === binding.stackId),
      binding.output,
      parameterType,
    );
  return (
    parameterType === "text" &&
    isPlanResultNode(plan.nodes.find((node) => node.id === binding.stepId)) &&
    hasPlanPath(plan.edges, binding.stepId, step.id)
  );
}

function isPlanAssetNameValid(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= PLAN_ASSET_NAME_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(trimmed)
  );
}

/** Structural checks apply to drafts too; missing connections are checked before Play. */
export function planConnectionIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentPlanIssue[] {
  plan = withPortlessPlanGroups(plan);
  const expanded = expandPlanLoops(expandPlanGroups(plan));
  const issues = [
    ...edgeIssues(expanded),
    ...planGroupIssues(plan, agents, false),
    ...planLoopIssues(plan, agents, false),
    ...planBranchingIssues(plan, agents),
    ...planStackIssues(plan, expanded),
  ];
  for (const node of expanded.nodes)
    if (
      node.type === "agent" ||
      node.type === "script" ||
      node.type === "git_closeout"
    )
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
    if (node.type === "asset" && !isPlanAssetNameValid(node.name))
      issues.push({ nodeId: node.id, port: null, reason: "name" });
  }
  return issues;
}

/**
 * Text inputs that `AGENT.md` names but nothing fills: no binding, no typed
 * value and no default.
 *
 * @remarks
 * A predecessor's result is never taken by itself, not even with a single
 * candidate; with several agents before the node the missing choice is named
 * as ambiguous.
 */
function placeholderIssues(
  step: AgentPlanStep,
  parameters: readonly AgentParameter[],
  input: { readonly markdown: string; readonly plan: AgentPlanInput },
): AgentPlanIssue[] {
  const named = placeholderNames(input.markdown);
  return parameters.flatMap((parameter): AgentPlanIssue[] => {
    if (parameter.type !== "text" || !named.has(parameter.name)) return [];
    const binding = step.bindings[parameter.name];
    if (binding && binding.kind !== "literal") return [];
    if (binding?.kind === "literal" && hasAgentParameterValue(binding.value))
      return [];
    if (!binding && hasAgentParameterValue(parameter.defaultValue)) return [];
    return [
      {
        nodeId: step.id,
        port: parameter.name,
        reason: missingResultReason(step, input.plan),
      },
    ];
  });
}

/** Whether the unfilled input has several agents before it to choose from, or none to take. */
function missingResultReason(
  step: AgentPlanStep,
  plan: AgentPlanInput,
): "resultAmbiguous" | "resultMissing" {
  const predecessors = planPredecessors(plan.edges, step.id);
  const candidates = plan.nodes.filter(
    (node) =>
      node.type === "agent" && node.id !== step.id && predecessors.has(node.id),
  ).length;
  return candidates > 1 ? "resultAmbiguous" : "resultMissing";
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
    (!step.configuration && !agent?.availability.isUsable) ||
    step.personalAgentId === ""
  )
    return [{ nodeId: step.id, port: null, reason: "agent" }];
  const parameters = configuration?.parameters ?? [];
  const unfilled = placeholderIssues(step, parameters, {
    markdown: configuration?.markdown ?? "",
    plan,
  });
  return parameters.flatMap((parameter): AgentPlanIssue[] => {
    const placeholder = unfilled.find((issue) => issue.port === parameter.name);
    if (placeholder) return [placeholder];
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
  });
}

/** Checks the shared configuration and missing required inputs before Play. */
function scriptIssues(
  script: AgentPlanScript,
  plan: AgentPlanInput,
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = script.inputs.flatMap(
    (input): AgentPlanIssue[] => {
      const binding = script.bindings[input.name];
      if (
        !input.isRequired ||
        (binding?.kind === "literal" &&
          hasAgentParameterValue(binding.value)) ||
        hasConnectedValue(binding, plan)
      )
        return [];
      return [{ nodeId: script.id, port: input.name, reason: "required" }];
    },
  );
  if (planScriptIssues(script).length > 0)
    issues.push({
      nodeId: script.id,
      port: null,
      reason: "scriptConfiguration",
    });
  return issues;
}

/** Work on another host leaves nothing in the local workspace that a closeout could publish. */
function hasRemoteWork(plan: AgentPlanInput): boolean {
  return (
    plan.executionTarget?.kind === "remote" ||
    plan.nodes.some(
      (node) =>
        (node.type === "agent" || node.type === "script") &&
        node.executionTarget?.kind === "remote",
    )
  );
}

/** Checks the ticket, the check command and the place of a Git closeout before Play. */
function gitCloseoutIssues(
  closeout: AgentPlanGitCloseout,
  plan: AgentPlanInput,
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const binding = closeout.bindings[PLAN_GIT_CLOSEOUT_TICKET_INPUT];
  if (
    !(binding?.kind === "literal" && hasAgentParameterValue(binding.value)) &&
    !hasConnectedValue(binding, plan)
  )
    issues.push({
      nodeId: closeout.id,
      port: PLAN_GIT_CLOSEOUT_TICKET_INPUT,
      reason: "required",
    });
  if (planGitCloseoutIssues(closeout).length > 0)
    issues.push({
      nodeId: closeout.id,
      port: null,
      reason: "gitCloseoutConfiguration",
    });
  if (hasRemoteWork(plan))
    issues.push({
      nodeId: closeout.id,
      port: null,
      reason: "gitCloseoutRemote",
    });
  return issues;
}

function hasConnectedValue(
  binding: AgentPlanBinding | undefined,
  plan: AgentPlanInput,
): boolean {
  if (binding && binding.kind !== "literal" && binding.kind !== "source")
    return true;
  if (binding?.kind !== "source") return false;
  const source = plan.nodes.find((node) => node.id === binding.nodeId);
  if (source?.type === "task") return true;
  if (source?.type === "asset") return source.file !== null;
  if (source?.type === "variable")
    return Boolean(plan.globals[source.name]?.trim());
  if (source?.type !== "parameter") return false;
  return hasAgentParameterValue(source.value);
}

/** The connections a flow node needs and the values its inputs miss. */
function flowNodeIssues(
  node: AgentPlanNode,
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const starts = plan.nodes.filter((entry) => entry.type === "start");
  const ends = plan.nodes.filter((entry) => entry.type === "end");
  // An event enters an agent that already ran; it never replaces the connection that starts it.
  const ordering = planOrderEdges(plan.edges);
  if (node.type !== "start" && !ordering.some((edge) => edge.to === node.id))
    issues.push({
      nodeId: node.id,
      port: node.type === "decision" ? "condition-in" : "flow-in",
      reason: "flowIn",
    });
  if (node.type !== "end" && !plan.edges.some((edge) => edge.from === node.id))
    issues.push({ nodeId: node.id, port: "flow-out", reason: "flowOut" });
  if (
    node.type !== "start" &&
    !starts.some((start) => hasPlanPath(plan.edges, start.id, node.id))
  )
    issues.push({ nodeId: node.id, port: "flow-in", reason: "unreachable" });
  if (
    node.type !== "end" &&
    !ends.some((end) => hasPlanReach(plan.edges, node.id, end.id))
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
  if (node.type === "script") issues.push(...scriptIssues(node, plan));
  if (node.type === "git_closeout")
    issues.push(...gitCloseoutIssues(node, plan));
  return issues;
}

/** The start, the end, the agent and the connections every flow node of a flat plan needs. */
function flowExecutionIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  const issues: AgentPlanIssue[] = [];
  const starts = plan.nodes.filter((node) => node.type === "start");
  const ends = plan.nodes.filter((node) => node.type === "end");
  if (starts.length === 0)
    issues.push({ nodeId: null, port: null, reason: "start" });
  if (ends.length === 0)
    issues.push({ nodeId: null, port: null, reason: "end" });
  if (
    !plan.nodes.some(
      (node) =>
        node.type === "agent" ||
        node.type === "script" ||
        node.type === "git_closeout",
    )
  )
    issues.push({ nodeId: null, port: null, reason: "agent" });
  for (const node of plan.nodes.filter(isPlanFlowNode)) {
    // A stack that nothing triggers is only read, like a value source.
    if (node.type === "stack" && !isPlanStackTriggered(plan, node.id)) continue;
    issues.push(...flowNodeIssues(node, plan, agents));
  }
  issues.push(...scriptReportGraphIssues(plan));
  issues.push(...planBranchingExecutionIssues(plan));
  issues.push(...assetFileIssues(plan));
  return issues;
}

/** An asset node that feeds an input needs a file before the run starts. */
function assetFileIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  const used = new Set(
    planBindingNodes(plan).flatMap((node) =>
      Object.values(node.bindings).flatMap((binding) =>
        binding.kind === "source" ? [binding.nodeId] : [],
      ),
    ),
  );
  return planAssets(plan).flatMap((asset): AgentPlanIssue[] =>
    asset.file === null && used.has(asset.id)
      ? [{ nodeId: asset.id, port: "value-out", reason: "assetFile" }]
      : [],
  );
}

/** A runnable DAG has explicit boundaries and no unreachable or unfinished flow branch. */
export function planExecutionIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentPlanIssue[] {
  plan = withPortlessPlanGroups(plan);
  if (plan.nodes.some((node) => node.type === "group")) {
    return [
      ...planConnectionIssues(plan, agents),
      ...planGroupIssues(plan, agents, true),
      ...planExecutionIssues(expandPlanGroups(plan), agents),
    ];
  }
  if (plan.nodes.some((node) => node.type === "loop")) {
    // The members are checked as flow nodes of the expanded plan; their loop
    // rules, such as bindings to the previous iteration, belong to the loop.
    return [
      ...planConnectionIssues(plan, agents),
      ...planLoopIssues(plan, agents, true),
      ...flowExecutionIssues(expandPlanLoops(plan), agents),
    ];
  }
  return [
    ...planConnectionIssues(plan, agents),
    ...flowExecutionIssues(plan, agents),
  ];
}
