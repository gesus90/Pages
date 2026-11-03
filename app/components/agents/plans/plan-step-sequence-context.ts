import { planEdgeKind, planRegion } from "@/definition/AgentPlanBranching";
import { expandPlanGroups } from "@/definition/AgentPlanGroup";
import { withPortlessPlanGroups } from "@/definition/AgentPlanGroupUpgrade";
import { planFlowSequence } from "@/definition/AgentPlanSequence";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStepActivation,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";

/**
 * How certain a block of the sequence is.
 *
 * @remarks
 * `actual` is an execution the run recorded as started; `planned` follows
 * from the known plan and the decisions taken so far; `assumed` is an
 * estimate, such as the next check of a while loop or the branch an open
 * decision is expected to take. Neither of the last two has started.
 */
export type PlanSequenceBlockKind = "actual" | "planned" | "assumed";

/** One execution of an agent or a script: a numbered block of the sequence. */
export interface PlanSequenceBlock {
  /** Unique in the run: the node with its start, or the loop iteration and the member. */
  readonly key: string;
  /** The node on the canvas, a loop member included. */
  readonly nodeId: string;
  readonly name: string;
  /** Which start of the node or which loop iteration this block is, counting from 1. */
  readonly pass: number;
  /** Whether the pass belongs to a loop iteration rather than to a repeated start. */
  readonly isLoopPass: boolean;
  readonly kind: PlanSequenceBlockKind;
  /** The record of this execution; absent for a block that exists only in the outlook. */
  readonly result?: AgentPlanStepResult;
}

/** What the sequence projection reads: the executed graph and the run's records. */
export interface PlanSequenceContext {
  /** The plan the run executes, its outer groups expanded into their agents. */
  readonly graph: AgentPlanInput;
  readonly nodes: ReadonlyMap<string, AgentPlanNode>;
  /** The numbered flow nodes, in the order of {@link planFlowSequence}. */
  readonly order: readonly string[];
  readonly results: ReadonlyMap<string, AgentPlanStepResult>;
  readonly loops: ReadonlyMap<string, AgentPlanLoopRun>;
  readonly cycles: readonly PlanSequenceCycle[];
  /** Whether the run can still execute something; a plan without a run can. */
  readonly isActive: boolean;
  readonly label: (node: AgentPlanNode) => string;
}

/**
 * A node that an event starts again, with the nodes that repeat with it.
 *
 * @remarks
 * `body` holds the target and every node of its region that leads to a sender
 * of the event: these run once per round. The other nodes of the region run
 * after the last round, typically on the branch a passing decision takes.
 */
export interface PlanSequenceCycle {
  readonly targetId: string;
  readonly sourceIds: readonly string[];
  readonly region: ReadonlySet<string>;
  readonly body: readonly string[];
}

/** Whether an agent or script result belongs to a start that actually began. */
export function hasStepStarted(step: AgentPlanStepResult | undefined): boolean {
  if (!step) return false;
  if (step.status === "cancelled") return step.cancellation !== "not_started";
  return (
    step.status === "running" ||
    step.status === "succeeded" ||
    step.status === "failed"
  );
}

/** Whether the node is a step of its own: only agents and scripts count. */
export function isSequenceStep(node: AgentPlanNode | undefined): boolean {
  return node?.type === "agent" || node?.type === "script";
}

/** The key of a start of an outer node. */
export function startKey(nodeId: string, pass: number): string {
  return `${nodeId}#${pass}`;
}

/** The key of a member in one loop iteration; it extends the iteration's id `loopId#number`. */
export function iterationKey(
  loopId: string,
  iteration: number,
  memberId: string,
): string {
  return `${loopId}#${iteration}/${memberId}`;
}

/** How many starts of the node the run recorded, the current one included. */
export function startCount(step: AgentPlanStepResult | undefined): number {
  if (!step) return 0;
  return (step.history?.length ?? 0) + (hasStepStarted(step) ? 1 : 0);
}

/**
 * The record of an earlier start, shaped like a result for the details.
 *
 * @remarks
 * It carries only what the run kept of that start; the session of the node
 * belongs to its newest start and is not copied.
 */
export function activationResult(
  step: AgentPlanStepResult,
  entry: AgentPlanStepActivation,
): AgentPlanStepResult {
  return {
    id: step.id,
    name: step.name,
    ...(step.groupId === undefined ? {} : { groupId: step.groupId }),
    status: entry.status,
    isBlocked: false,
    cancellation: "none",
    output: entry.output,
    error: entry.error,
    activation: entry.activation,
    ...(entry.passed === undefined ? {} : { passed: entry.passed }),
    ...(entry.trigger === undefined ? {} : { trigger: entry.trigger }),
  };
}

function sequenceCycles(
  graph: AgentPlanInput,
  order: readonly string[],
): readonly PlanSequenceCycle[] {
  const sources = new Map<string, string[]>();
  for (const edge of graph.edges)
    if (planEdgeKind(edge) === "event")
      sources.set(edge.to, [...(sources.get(edge.to) ?? []), edge.from]);
  return order.flatMap((targetId) => {
    const sourceIds = sources.get(targetId);
    if (!sourceIds) return [];
    const region = planRegion(graph.edges, targetId);
    const body = order.filter(
      (id) =>
        id === targetId ||
        (region.has(id) &&
          (sourceIds.includes(id) ||
            sourceIds.some((source) =>
              planRegion(graph.edges, id).has(source),
            ))),
    );
    return [{ targetId, sourceIds, region, body }];
  });
}

/**
 * Collects what the sequence projection needs from a run and its plan.
 *
 * @param run - The run, or `null` for the outlook of a plan before it runs.
 * @param plan - The plan revision the run executes.
 * @param label - Names a node that has no record yet.
 */
export function planSequenceContext(
  run: AgentPlanRun | null,
  plan: AgentPlanInput,
  label: (node: AgentPlanNode) => string,
): PlanSequenceContext {
  const graph = expandPlanGroups(withPortlessPlanGroups(plan));
  const order = planFlowSequence(graph).order;
  return {
    graph,
    nodes: new Map(graph.nodes.map((node) => [node.id, node])),
    order,
    results: new Map(run?.steps.map((step) => [step.id, step])),
    loops: new Map(run?.loops?.map((loop) => [loop.id, loop])),
    cycles: sequenceCycles(graph, order),
    isActive: run ? isActivePlanRun(run.status) : true,
    label,
  };
}
