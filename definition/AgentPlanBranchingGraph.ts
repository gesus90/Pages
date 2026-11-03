import { planStepAdapter } from "./AgentPlanGroup";
import { hasPlanPath } from "./AgentPlanPath";
import {
  PLAN_PORT,
  isPlanEventEdge,
  planEdgeBranch,
  planEdgeKind,
  planOrderEdges,
  planReceivesEvents,
  planRegion,
  planReportsPassed,
} from "./AgentPlanBranching";

import type { AgentDefinitionChoice } from "./AgentAvailability";
import type {
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "./AgentPlan";
import type { AgentPlanEdgeKind } from "./AgentPlanBranching";
import type { AgentPlanIssue } from "./AgentPlanGraph";

/** The node types an edge of each kind may leave. */
const SOURCE_TYPES: Readonly<Record<AgentPlanEdgeKind, readonly string[]>> = {
  flow: ["start", "agent", "script", "stack"],
  branch: ["decision"],
  condition: ["agent"],
  event: ["agent", "script"],
};

/** The node types an edge of each kind may enter. */
const TARGET_TYPES: Readonly<Record<AgentPlanEdgeKind, readonly string[]>> = {
  flow: ["end", "agent", "script", "stack"],
  branch: ["end", "agent", "script", "stack"],
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

/**
 * Whether a decision lets only one of the two nodes start in any round.
 *
 * @remarks
 * A node that only the true output leads to and a node that only the false
 * output leads to never run together: the decision activates one of them per
 * round, and the next round starts after the first has ended.
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
    const targets = (branch: "true" | "false"): string[] =>
      edges
        .filter(
          (edge) => edge.from === decision && planEdgeBranch(edge) === branch,
        )
        .map((edge) => edge.to);
    const onTrue = planReachedFrom(edges, targets("true"));
    const onFalse = planReachedFrom(edges, targets("false"));
    const isOnlyTrue = (id: string): boolean =>
      onTrue.has(id) && !onFalse.has(id);
    const isOnlyFalse = (id: string): boolean =>
      onFalse.has(id) && !onTrue.has(id);
    return (
      (isOnlyTrue(first) && isOnlyFalse(second)) ||
      (isOnlyFalse(first) && isOnlyTrue(second))
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

/** A condition, branch or event connection may only join top-level nodes, never a group or a loop. */
function boundaryIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  const inside = new Set(
    plan.nodes.flatMap((node): readonly string[] => {
      if (node.type === "group")
        return [node.id, ...node.steps.map((step) => step.id)];
      if (node.type !== "loop") return [];
      return [
        node.id,
        ...node.steps.flatMap((step): readonly string[] =>
          step.type === "group"
            ? [step.id, ...step.steps.map((entry) => entry.id)]
            : [step.id],
        ),
      ];
    }),
  );
  return plan.edges.flatMap((edge): AgentPlanIssue[] => {
    const kind = planEdgeKind(edge);
    if (kind === null || kind === "flow") return [];
    if (inside.has(edge.from))
      return [
        { nodeId: edge.from, port: edge.fromPort, reason: "branchBoundary" },
      ];
    return inside.has(edge.to)
      ? [{ nodeId: edge.to, port: edge.toPort, reason: "branchBoundary" }]
      : [];
  });
}

/** A decision reads exactly one boolean result. */
function conditionIssues(
  plan: AgentPlanInput,
  isExecution: boolean,
): AgentPlanIssue[] {
  return plan.nodes.flatMap((node): AgentPlanIssue[] => {
    if (node.type !== "decision") return [];
    const count = plan.edges.filter(
      (edge) => edge.to === node.id && planEdgeKind(edge) === "condition",
    ).length;
    const isMissing = isExecution && count === 0;
    return count > 1 || isMissing
      ? [
          {
            nodeId: node.id,
            port: PLAN_PORT.conditionIn,
            reason: "decisionCondition",
          },
        ]
      : [];
  });
}

/** Both outputs of a decision lead somewhere, so no evaluation ends in a dead end. */
function branchIssues(plan: AgentPlanInput): AgentPlanIssue[] {
  return plan.nodes.flatMap((node): AgentPlanIssue[] => {
    if (node.type !== "decision") return [];
    return [PLAN_PORT.trueOut, PLAN_PORT.falseOut].flatMap(
      (port): AgentPlanIssue[] =>
        plan.edges.some(
          (edge) => edge.from === node.id && edge.fromPort === port,
        )
          ? []
          : [{ nodeId: node.id, port, reason: "decisionBranch" }],
    );
  });
}

/**
 * The structural findings of decisions, boolean results and events, valid for drafts too.
 *
 * @param plan - The plan with its groups and loops still in place.
 * @param agents - The agents the editor or the server knows.
 *
 * @remarks
 * A decision, boolean result or event belongs to the top level of a plan: a
 * group or loop keeps its own session policy, and a remote runner has no
 * place to keep an open session between two starts.
 */
export function planBranchingIssues(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): readonly AgentPlanIssue[] {
  return [
    ...boundaryIssues(plan),
    ...eventRegionIssues(plan),
    ...conditionIssues(plan, false),
    ...plan.nodes.flatMap((node) =>
      node.type === "agent" ? stepIssues(node, plan, agents) : [],
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
