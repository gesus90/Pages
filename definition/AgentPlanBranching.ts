import type { AgentPlanEdge, AgentPlanInput } from "./AgentPlan";

/**
 * The port identifiers of the connections a decision and the retrigger use.
 *
 * @remarks
 * An edge names the handle it leaves and the handle it enters, so the editor
 * and the scheduler read the same contract. `flow-*` and `value-out` exist
 * since the first plans; the others belong to the Decision node (PAGE-174).
 */
export const PLAN_PORT = {
  flowIn: "flow-in",
  flowOut: "flow-out",
  /** The text result of an agent or script. */
  valueOut: "value-out",
  /** The boolean result of an agent: `true` when its run passed. */
  passedOut: "passed-out",
  /** The boolean input of a decision. */
  conditionIn: "condition-in",
  trueOut: "true-out",
  falseOut: "false-out",
  /** The optional input of an agent that carries a new prompt for its open session. */
  eventIn: "event-in",
} as const;

/**
 * What an edge means, derived from the ports it connects.
 *
 * @remarks
 * `flow` orders execution. `branch` leaves a decision through its true or
 * false output and orders execution too. `condition` carries the boolean
 * result of an agent into a decision and orders execution as well: the
 * decision waits for the agent. Only `event` never orders anything: it
 * returns new information to an agent that already ran, so it is the way back
 * of a cycle, not a dependency.
 */
export type AgentPlanEdgeKind = "flow" | "branch" | "condition" | "event";

/** The branch of a decision a result belongs to. */
export type AgentPlanBranch = "true" | "false";

/**
 * How often one node may start again inside one run.
 *
 * @remarks
 * A fix cycle that never passes would otherwise run, and bill, without end.
 * The limit counts the starts of a node, the first one included.
 */
export const PLAN_ACTIVATION_LIMIT = 25;

/**
 * The longest event prompt a node accepts, the limit of a remote prompt.
 *
 * @remarks
 * Pages never shortens a prompt: a longer result is refused with a concrete
 * hint instead of being cut.
 */
export const PLAN_EVENT_PROMPT_LIMIT = 100_000;

/** What an edge connects; `null` for a pair of ports the plan has no meaning for. */
export function planEdgeKind(
  edge: Pick<AgentPlanEdge, "fromPort" | "toPort">,
): AgentPlanEdgeKind | null {
  const { fromPort, toPort } = edge;
  if (toPort === PLAN_PORT.flowIn) {
    if (fromPort === PLAN_PORT.flowOut) return "flow";
    if (fromPort === PLAN_PORT.trueOut || fromPort === PLAN_PORT.falseOut)
      return "branch";
    return null;
  }
  if (fromPort === PLAN_PORT.passedOut && toPort === PLAN_PORT.conditionIn)
    return "condition";
  if (fromPort === PLAN_PORT.valueOut && toPort === PLAN_PORT.eventIn)
    return "event";
  return null;
}

/** The branch a decision edge leaves through, or `null` for any other edge. */
export function planEdgeBranch(
  edge: Pick<AgentPlanEdge, "fromPort">,
): AgentPlanBranch | null {
  if (edge.fromPort === PLAN_PORT.trueOut) return "true";
  return edge.fromPort === PLAN_PORT.falseOut ? "false" : null;
}

/** The output port of a decision for a branch. */
export function planBranchPort(
  branch: AgentPlanBranch,
): typeof PLAN_PORT.trueOut | typeof PLAN_PORT.falseOut {
  return branch === "true" ? PLAN_PORT.trueOut : PLAN_PORT.falseOut;
}

/** Whether the edge returns an event; such an edge orders nothing. */
export function isPlanEventEdge(edge: Pick<AgentPlanEdge, "toPort">): boolean {
  return edge.toPort === PLAN_PORT.eventIn;
}

/**
 * The edges that order execution: every edge except the way back of an event.
 *
 * @param edges - The edges of a plan.
 */
export function planOrderEdges(
  edges: readonly AgentPlanEdge[],
): readonly AgentPlanEdge[] {
  return edges.some(isPlanEventEdge)
    ? edges.filter((edge) => !isPlanEventEdge(edge))
    : edges;
}

/**
 * Whether the plan has a decision, a stack, a boolean result in use or an event connection.
 *
 * @remarks
 * A stack belongs here because a used-up stack activates nothing behind its
 * flow output, like the branch a decision did not take.
 */
export function hasPlanBranching(
  plan: Pick<AgentPlanInput, "nodes" | "edges">,
): boolean {
  return (
    plan.nodes.some(
      (node) => node.type === "decision" || node.type === "stack",
    ) ||
    plan.edges.some((edge) => {
      const kind = planEdgeKind(edge);
      return kind === "condition" || kind === "event";
    })
  );
}

/** The agents and scripts that send their result to the event input of a node. */
export function planEventSources(
  plan: Pick<AgentPlanInput, "edges">,
  targetId: string,
): readonly string[] {
  return plan.edges
    .filter((edge) => edge.to === targetId && isPlanEventEdge(edge))
    .map((edge) => edge.from);
}

/** Whether another node can send an event to the node, which then keeps its session open. */
export function planReceivesEvents(
  plan: Pick<AgentPlanInput, "edges">,
  stepId: string,
): boolean {
  return plan.edges.some((edge) => edge.to === stepId && isPlanEventEdge(edge));
}

/** Whether a decision reads the boolean result of the agent, which is then reported as passed or not. */
export function planReportsPassed(
  plan: Pick<AgentPlanInput, "edges">,
  stepId: string,
): boolean {
  return plan.edges.some(
    (edge) => edge.from === stepId && edge.fromPort === PLAN_PORT.passedOut,
  );
}

/** The agent whose boolean result a decision reads, or `null` without exactly one. */
export function planConditionSource(
  plan: Pick<AgentPlanInput, "edges">,
  decisionId: string,
): string | null {
  const sources = plan.edges.filter(
    (edge) => edge.to === decisionId && planEdgeKind(edge) === "condition",
  );
  return sources.length === 1 ? (sources[0]?.from ?? null) : null;
}

/**
 * Every node that runs after the node along execution edges, the node excluded.
 *
 * @param edges - The edges of a plan; event edges are ignored.
 * @param startId - The node whose followers are wanted.
 * @returns The followers; the node itself only when it lies on a cycle.
 *
 * @remarks
 * When an event starts a node again, exactly these nodes forget what they
 * decided or produced for the earlier round.
 */
export function planRegion(
  edges: readonly AgentPlanEdge[],
  startId: string,
): ReadonlySet<string> {
  const ordering = planOrderEdges(edges);
  const region = new Set<string>();
  const pending = [startId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    for (const edge of ordering)
      if (edge.from === current && !region.has(edge.to)) {
        region.add(edge.to);
        pending.push(edge.to);
      }
  }
  return region;
}
