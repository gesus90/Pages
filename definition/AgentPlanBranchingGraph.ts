import { isAcpProvider } from "./AgentConfiguration";
import { expandPlanGroups, planStepAdapter } from "./AgentPlanGroup";
import {
  expandPlanLoops,
  planLoopDecisions,
  planLoopGroups,
  planLoopMembers,
} from "./AgentPlanLoop";
import { hasPlanPath } from "./AgentPlanPath";
import {
  PLAN_PORT,
  isPlanEventEdge,
  planContainedEdges,
  planEdgeBranch,
  planEdgeKind,
  planOrderEdges,
  planReceivesEvents,
  planRegion,
  planReportsPassed,
} from "./AgentPlanBranching";
import {
  PLAN_DECISION_QUESTION_LENGTH,
  planDecisionBinding,
  planDecisionCasesProblem,
  planDecisionMode,
  planDecisionOutput,
  planDecisionOutputPorts,
} from "./AgentPlanDecision";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type {
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanLoop } from "./AgentPlanLoop";
import type { AgentPlanEdgeKind } from "./AgentPlanBranching";
import type { AgentPlanIssue } from "./AgentPlanGraph";

/** The node types an edge of each kind may leave. */
const SOURCE_TYPES: Readonly<Record<AgentPlanEdgeKind, readonly string[]>> = {
  flow: ["start", "agent", "script", "git_closeout", "stack", "swarm"],
  branch: ["decision"],
  condition: ["agent"],
  event: ["agent", "script"],
};

/** The node types an edge of each kind may enter. */
const TARGET_TYPES: Readonly<Record<AgentPlanEdgeKind, readonly string[]>> = {
  flow: [
    "end",
    "agent",
    "script",
    "git_closeout",
    "stack",
    "decision",
    "swarm",
  ],
  branch: [
    "end",
    "agent",
    "script",
    "git_closeout",
    "stack",
    "decision",
    "swarm",
  ],
  condition: ["decision"],
  event: ["agent"],
};

/** A script hands its result on only when it declares exactly one output. */
function isEdgeSource(node: AgentPlanNode | undefined): boolean {
  return node?.type !== "script" || node.outputs.length === 1;
}

/**
 * Whether an edge connects nodes its ports allow, and where it does not.
 *
 * @param plan - A plan whose groups and loops are expanded.
 * @param edge - The edge to check.
 * @returns One issue per end of the edge that does not fit; none when it fits.
 */
export function planEdgeEndpointIssues(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
  edge: AgentPlanEdge,
): AgentPlanIssue[] {
  const source = plan.nodes.find((node) => node.id === edge.from);
  const target = plan.nodes.find((node) => node.id === edge.to);
  const kind = planEdgeKind(edge);
  const sourceType = source?.type ?? "";
  const targetType = target?.type ?? "";
  const isSourceValid =
    kind !== null &&
    SOURCE_TYPES[kind].includes(sourceType) &&
    (kind !== "event" || isEdgeSource(source));
  const isTargetValid =
    kind !== null && TARGET_TYPES[kind].includes(targetType);
  const issues: AgentPlanIssue[] = [];
  if (!isSourceValid)
    issues.push({
      nodeId: edge.from,
      port: edge.fromPort,
      reason: source?.type === "group" ? "groupBoundary" : "port",
    });
  if (!isTargetValid)
    issues.push({
      nodeId: edge.to,
      port: edge.toPort,
      reason: target?.type === "group" ? "groupBoundary" : "port",
    });
  return issues;
}

/** A result returns to one event input only: the target that starts again forgets the start of every node behind it. */
function eventFanoutIssues(
  plan: Pick<AgentPlanInput, "edges">,
  edge: AgentPlanEdge,
): AgentPlanIssue[] {
  const first = plan.edges.find(
    (entry) => entry.from === edge.from && isPlanEventEdge(entry),
  );
  return first === edge
    ? []
    : [{ nodeId: edge.from, port: PLAN_PORT.valueOut, reason: "eventFanout" }];
}

/**
 * An event may not return across another agent that receives events and lies on the way.
 *
 * @remarks
 * Starting the target again makes every node behind it forget its start. An
 * agent with its own event input among them would start again without the
 * news it was built for, and its session would take the main instruction as
 * a follow-up. Two cycles one after the other are fine: only a return from
 * behind the second one to before the first is refused.
 */
function eventNestingIssues(
  plan: Pick<AgentPlanInput, "edges">,
  edge: AgentPlanEdge,
): AgentPlanIssue[] {
  const isNested = plan.edges.some(
    (other) =>
      isPlanEventEdge(other) &&
      other.to !== edge.to &&
      hasPlanPath(plan.edges, edge.to, other.to) &&
      hasPlanPath(plan.edges, other.to, edge.from),
  );
  return isNested
    ? [{ nodeId: edge.to, port: PLAN_PORT.eventIn, reason: "eventNesting" }]
    : [];
}

/**
 * What is wrong with an event edge: where it returns to, how often, and across what.
 *
 * @remarks
 * An event hands new information to an agent that already ran, so its source
 * must lie behind the target. Any other event would arrive before the first
 * start of the target, or without any relation to it.
 */
export function planEventOrderIssues(
  plan: Pick<AgentPlanInput, "edges">,
  edge: AgentPlanEdge,
): AgentPlanIssue[] {
  if (planEdgeKind(edge) !== "event") return [];
  if (!hasPlanPath(plan.edges, edge.to, edge.from))
    return [{ nodeId: edge.to, port: PLAN_PORT.eventIn, reason: "eventOrder" }];
  return [...eventFanoutIssues(plan, edge), ...eventNestingIssues(plan, edge)];
}

/** Whether any chain of edges, event edges included, leads from one node to another. */
export function hasPlanReach(
  edges: readonly AgentPlanEdge[],
  from: string,
  to: string,
): boolean {
  const visited = new Set<string>();
  const pending = [from];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of edges) {
      if (edge.from !== id) continue;
      if (edge.to === to) return true;
      pending.push(edge.to);
    }
  }
  return false;
}

/** Every node an execution edge leads to from the targets of one output, those targets included. */
function planReachedFrom(
  edges: readonly AgentPlanEdge[],
  starts: readonly string[],
): ReadonlySet<string> {
  const ordering = planOrderEdges(edges);
  const reached = new Set<string>();
  const pending = [...starts];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (reached.has(id)) continue;
    reached.add(id);
    for (const edge of ordering) if (edge.from === id) pending.push(edge.to);
  }
  return reached;
}

/** The single output of the decision that reaches the node, or `null` for none or several. */
function onlyBranch(
  reached: ReadonlyMap<string, ReadonlySet<string>>,
  id: string,
): string | null {
  const branches = [...reached].filter(([, nodes]) => nodes.has(id));
  return branches.length === 1 ? (branches[0]?.[0] ?? null) : null;
}

/**
 * Whether a decision lets only one of the two nodes start in any round.
 *
 * @remarks
 * Two nodes that only different outputs of one decision lead to never run
 * together: the decision activates one output per round, and the next round
 * starts after the first has ended. This holds for true and false and for the
 * values of a classification alike (PAGE-286).
 */
function arePlanBranchesExclusive(
  edges: readonly AgentPlanEdge[],
  first: string,
  second: string,
): boolean {
  const decisions = new Set(
    edges.filter((edge) => planEdgeBranch(edge) !== null).map((e) => e.from),
  );
  return [...decisions].some((decision) => {
    const leaving = edges.filter(
      (edge) => edge.from === decision && planEdgeBranch(edge) !== null,
    );
    const reached = new Map(
      [...new Set(leaving.map((edge) => edge.fromPort))].map((port) => [
        port,
        planReachedFrom(
          edges,
          leaving.filter((edge) => edge.fromPort === port).map((e) => e.to),
        ),
      ]),
    );
    const firstBranch = onlyBranch(reached, first);
    const secondBranch = onlyBranch(reached, second);
    return (
      firstBranch !== null &&
      secondBranch !== null &&
      firstBranch !== secondBranch
    );
  });
}

/**
 * Whether two nodes cannot run at the same time: one runs after the other, or a decision lets only one of them start.
 *
 * @param edges - The edges of a plan.
 * @param first - One node.
 * @param second - The other node.
 */
export function arePlanNodesOrdered(
  edges: readonly AgentPlanEdge[],
  first: string,
  second: string,
): boolean {
  return (
    hasPlanPath(edges, first, second) ||
    hasPlanPath(edges, second, first) ||
    arePlanBranchesExclusive(edges, first, second)
  );
}

function isRemote(step: AgentPlanStep, plan: AgentPlanInput): boolean {
  return (step.executionTarget ?? plan.executionTarget)?.kind === "remote";
}

/** What an agent that reports a boolean result or receives events needs from its runner. */
function stepIssues(
  step: AgentPlanStep,
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): AgentPlanIssue[] {
  if (!planReportsPassed(plan, step.id) && !planReceivesEvents(plan, step.id))
    return [];
  const issues: AgentPlanIssue[] = [];
  if (planStepAdapter(step, agents) === null)
    issues.push({
      nodeId: step.id,
      port: "provider/adapter",
      reason: "branchProvider",
    });
  if (isRemote(step, plan))
    issues.push({ nodeId: step.id, port: null, reason: "branchRemote" });
  if (step.completionGate)
    issues.push({ nodeId: step.id, port: null, reason: "branchGate" });
  return issues;
}

/**
 * A group or loop behind the target of an event, which would have to run again in the next round.
 *
 * @remarks
 * A loop keeps its finished iterations and a group its shared session, so
 * neither starts over when an event starts the agent in front of it again.
 */
function eventRegionIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  const behind = new Set(
    plan.edges
      .filter(isPlanEventEdge)
      .flatMap((edge) => [...planRegion(plan.edges, edge.to)]),
  );
  return plan.nodes
    .filter(
      (node) =>
        (node.type === "group" || node.type === "loop") && behind.has(node.id),
    )
    .map((node) => ({
      nodeId: node.id,
      port: null,
      reason: "branchBoundary",
    }));
}

/**
 * The container of every node inside a group or loop: the group, or the loop
 * for its members, its decisions and the agents of its groups.
 */
function planContainers(plan: AgentPlanInput): ReadonlyMap<string, string> {
  const containers = new Map<string, string>();
  for (const node of plan.nodes) {
    if (node.type === "group")
      for (const entry of [...node.steps, ...(node.decisions ?? [])])
        containers.set(entry.id, node.id);
    if (node.type !== "loop") continue;
    const inside = [
      ...planLoopMembers(node),
      ...planLoopDecisions(node),
      ...planLoopGroups(node),
    ];
    for (const entry of inside) containers.set(entry.id, node.id);
  }
  return containers;
}

/**
 * Condition and branch edges join nodes of the same container; an event never enters a group or loop.
 *
 * @remarks
 * A decision may stand at the top level, in a group or in a loop (PAGE-286):
 * its sequence, condition and outputs stay in the same frame, a loop's
 * iteration included. Only its bound data input may come from outside, like
 * every other binding.
 */
function boundaryIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  const containers = planContainers(plan);
  const frameNodes = new Set(
    plan.nodes
      .filter((node) => node.type === "group" || node.type === "loop")
      .map((node) => node.id),
  );
  return planContainedEdges(plan).flatMap((edge): AgentPlanIssue[] => {
    const kind = planEdgeKind(edge);
    if (kind === null || kind === "flow") return [];
    const from = containers.get(edge.from);
    const to = containers.get(edge.to);
    const isCrossing =
      kind === "event"
        ? from !== undefined ||
          to !== undefined ||
          frameNodes.has(edge.from) ||
          frameNodes.has(edge.to)
        : from !== to;
    if (!isCrossing) return [];
    return to === undefined && !frameNodes.has(edge.to)
      ? [{ nodeId: edge.from, port: edge.fromPort, reason: "branchBoundary" }]
      : [{ nodeId: edge.to, port: edge.toPort, reason: "branchBoundary" }];
  });
}

/** The flat view of a plan: groups and loops dissolved, decisions inside them included. */
function flatPlan(plan: AgentPlanInput): AgentPlanInput {
  return expandPlanLoops(expandPlanGroups(plan));
}

/** Agents, scripts with one output and the Git closeout hand on a text result. */
function isTextResult(node: AgentPlanNode | undefined): boolean {
  return (
    node?.type === "agent" ||
    node?.type === "git_closeout" ||
    (node?.type === "script" && node.outputs.length === 1)
  );
}

/** What is wrong with the bound data input of a decision for its mode, or `null`. */
function bindingProblem(
  decision: AgentPlanDecision,
  flat: AgentPlanInput,
  loopMembers: ReadonlySet<string> | null,
): "decisionInput" | "resultOrder" | "loopBoundary" | null {
  const binding = planDecisionBinding(decision);
  if (!binding) return null;
  const isModel = planDecisionMode(decision) === "model";
  if (binding.kind === "source") {
    const source = flat.nodes.find((node) => node.id === binding.nodeId);
    const fits = isModel
      ? source?.type === "task"
      : source?.type === "parameter" && source.format === "boolean";
    return fits ? null : "decisionInput";
  }
  if (binding.kind !== "result" || !isModel) return "decisionInput";
  if (!isTextResult(flat.nodes.find((node) => node.id === binding.stepId)))
    return "decisionInput";
  if (loopMembers && !loopMembers.has(binding.stepId)) return "loopBoundary";
  return hasPlanPath(flat.edges, binding.stepId, decision.id)
    ? null
    : "resultOrder";
}

/** The members of the loop a decision belongs to, or `null` outside every loop. */
function loopMembersOf(
  plan: AgentPlanInput,
  decisionId: string,
): ReadonlySet<string> | null {
  const loop = plan.nodes.find(
    (node): node is AgentPlanLoop =>
      node.type === "loop" &&
      planLoopDecisions(node).some((entry) => entry.id === decisionId),
  );
  return loop
    ? new Set(planLoopMembers(loop).map((member) => member.id))
    : null;
}

/** What one decision misses or has too much of in its data input. */
function inputIssues(
  decision: AgentPlanDecision,
  plan: AgentPlanInput,
  flat: AgentPlanInput,
  isExecution: boolean,
): AgentPlanIssue[] {
  const conditions = flat.edges.filter(
    (edge) => edge.to === decision.id && planEdgeKind(edge) === "condition",
  ).length;
  const binding = planDecisionBinding(decision);
  const count = conditions + (binding ? 1 : 0);
  const port = PLAN_PORT.conditionIn;
  if (count > 1 || (isExecution && count === 0))
    return [{ nodeId: decision.id, port, reason: "decisionCondition" }];
  if (conditions > 0 && planDecisionMode(decision) === "model")
    return [{ nodeId: decision.id, port, reason: "decisionInput" }];
  const problem = bindingProblem(
    decision,
    flat,
    loopMembersOf(plan, decision.id),
  );
  return problem ? [{ nodeId: decision.id, port, reason: problem }] : [];
}

/** What a model decision needs besides its input: a question, an ACP model and, to classify, a valid list. */
function modelIssues(decision: AgentPlanDecision): AgentPlanIssue[] {
  if (planDecisionMode(decision) !== "model") return [];
  const issues: AgentPlanIssue[] = [];
  const question = decision.question?.trim() ?? "";
  if (question.length === 0 || question.length > PLAN_DECISION_QUESTION_LENGTH)
    issues.push({
      nodeId: decision.id,
      port: "question",
      reason: "decisionQuestion",
    });
  const model = decision.model;
  if (!model?.connectionId || !model.model || !isAcpProvider(model.provider))
    issues.push({
      nodeId: decision.id,
      port: "model",
      reason: "decisionModel",
    });
  if (
    planDecisionOutput(decision) === "classification" &&
    planDecisionCasesProblem(decision.cases) !== null
  )
    issues.push({
      nodeId: decision.id,
      port: "cases",
      reason: "decisionCases",
    });
  return issues;
}

/**
 * A decision that reads a parameter, a ticket or a text result needs a sequence input.
 *
 * @remarks
 * A data input alone never starts a decision. Only the boolean edge of an
 * agent keeps starting it without one, as every decision before PAGE-286 did.
 */
function sequenceIssues(
  decision: AgentPlanDecision,
  flat: AgentPlanInput,
): AgentPlanIssue[] {
  if (!planDecisionBinding(decision)) return [];
  const hasSequence = flat.edges.some(
    (edge) =>
      edge.to === decision.id &&
      (planEdgeKind(edge) === "flow" || planEdgeKind(edge) === "branch"),
  );
  return hasSequence
    ? []
    : [
        {
          nodeId: decision.id,
          port: PLAN_PORT.flowIn,
          reason: "decisionSequence",
        },
      ];
}

/** Every decision of the plan with its own findings: its input, sequence and model settings. */
function conditionIssues(
  plan: AgentPlanInput,
  isExecution: boolean,
): AgentPlanIssue[] {
  const flat = flatPlan(plan);
  return flat.nodes.flatMap((node): AgentPlanIssue[] => {
    if (node.type !== "decision") return [];
    // A half-done model decision can be saved; it only may not start.
    return [
      ...inputIssues(node, plan, flat, isExecution),
      ...(isExecution
        ? [...modelIssues(node), ...sequenceIssues(node, flat)]
        : []),
    ];
  });
}

/**
 * Every output of a decision leads somewhere, and no edge leaves an output it does not have.
 *
 * @remarks
 * Yes or no and booleans have two outputs, a classification one per value.
 * An edge of a value that was deleted, or of `true-out` after a switch to a
 * classification, is a port that no longer exists.
 */
function branchIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  const flat = flatPlan(plan);
  return flat.nodes.flatMap((node): AgentPlanIssue[] => {
    if (node.type !== "decision") return [];
    const ports = planDecisionOutputPorts(node);
    const leaving = flat.edges.filter(
      (edge) => edge.from === node.id && planEdgeKind(edge) === "branch",
    );
    return [
      ...ports.flatMap((port): AgentPlanIssue[] =>
        leaving.some((edge) => edge.fromPort === port)
          ? []
          : [{ nodeId: node.id, port, reason: "decisionBranch" }],
      ),
      ...leaving
        .filter((edge) => !ports.includes(edge.fromPort))
        .map((edge): AgentPlanIssue => ({
          nodeId: node.id,
          port: edge.fromPort,
          reason: "port",
        })),
    ];
  });
}

/**
 * The structural findings of decisions, boolean results and events, valid for drafts too.
 *
 * @param plan - The plan with its groups and loops still in place.
 * @param agents - The agents the editor or the server knows.
 *
 * @remarks
 * An event belongs to the top level of a plan: a group or loop keeps its own
 * session policy, and a remote runner has no place to keep an open session
 * between two starts. A decision and a boolean result may stand in a group or
 * loop too, as long as their edges stay inside it (PAGE-286).
 */
export function planBranchingIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentPlanIssue[] {
  const flat = flatPlan(plan);
  return [
    ...boundaryIssues(plan),
    ...eventRegionIssues(plan),
    ...conditionIssues(plan, false),
    ...flat.nodes.flatMap((node) =>
      node.type === "agent" ? stepIssues(node, flat, agents) : [],
    ),
  ];
}

/**
 * What a decision still misses before the plan may start.
 *
 * @param plan - A flat plan, as the engine runs it.
 */
export function planBranchingExecutionIssues(
  plan: AgentPlanInput,
): readonly AgentPlanIssue[] {
  return [...conditionIssues(plan, true), ...branchIssues(plan)];
}
