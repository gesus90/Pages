import {
  PLAN_ACTIVATION_LIMIT,
  planEdgeBranch,
  planOrderEdges,
} from "@/definition/AgentPlanBranching";

import {
  planLoopOutlook,
  planLoopStepOrder,
  startedLoopOutlook,
} from "./plan-step-sequence-loop";
import {
  hasStepStarted,
  isSequenceStep,
  iterationKey,
  startCount,
  startKey,
} from "./plan-step-sequence-context";

import type {
  AgentPlanEdge,
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type {
  AgentPlanLoop,
  AgentPlanLoopMember,
} from "@/definition/AgentPlanLoop";
import type { PlanLoopOutlook } from "./plan-step-sequence-loop";
import type {
  PlanSequenceBlock,
  PlanSequenceBlockKind,
  PlanSequenceContext,
  PlanSequenceCycle,
} from "./plan-step-sequence-context";

/**
 * What the current round expects of a node.
 *
 * @remarks
 * `isDead` marks a node that cannot run in this round: the branch it lies on
 * was not taken, or is not expected to be taken. `isUncertain` marks a node
 * that runs only if an open decision takes the branch it is expected to take.
 */
interface RoundState {
  readonly isDead: boolean;
  readonly isUncertain: boolean;
}

type Results = ReadonlyMap<string, AgentPlanStepResult>;

function isOpenDecision(
  node: AgentPlanNode | undefined,
  source: AgentPlanStepResult | undefined,
): boolean {
  return node?.type === "decision" && source?.status !== "succeeded";
}

/**
 * Whether an edge cannot release its target in this round.
 *
 * @remarks
 * It mirrors the scheduler: the branch a decision did not activate, a skipped
 * source and a used-up stack are dead. An open decision is expected to pass,
 * so its `false` branch counts as dead until the decision says otherwise.
 */
function isDeadEdge(
  edge: AgentPlanEdge,
  node: AgentPlanNode | undefined,
  source: AgentPlanStepResult | undefined,
  state: RoundState | undefined,
): boolean {
  if (state?.isDead || source?.status === "skipped") return true;
  if (node?.type === "decision") {
    const branch = planEdgeBranch(edge);
    if (branch === null) return false;
    return source?.status === "succeeded"
      ? source.branch !== branch
      : branch === "false";
  }
  return source?.status === "succeeded" && source.stack?.entryId === null;
}

/** Projects which nodes the current round can still reach, and how surely. */
function projectRound(
  context: PlanSequenceContext,
  results: Results,
): ReadonlyMap<string, RoundState> {
  const numbered = new Set(context.order);
  const ordering = planOrderEdges(context.graph.edges).filter(
    (edge) => numbered.has(edge.from) && numbered.has(edge.to),
  );
  const states = new Map<string, RoundState>();
  for (const id of context.order) {
    const incoming = ordering.filter((edge) => edge.to === id);
    const live = incoming.filter(
      (edge) =>
        !isDeadEdge(
          edge,
          context.nodes.get(edge.from),
          results.get(edge.from),
          states.get(edge.from),
        ),
    );
    const isDead =
      results.get(id)?.status === "skipped" ||
      (incoming.length > 0 && live.length === 0);
    const isUncertain =
      !isDead &&
      live.some(
        (edge) =>
          states.get(edge.from)?.isUncertain === true ||
          isOpenDecision(context.nodes.get(edge.from), results.get(edge.from)),
      );
    states.set(id, { isDead, isUncertain });
  }
  return states;
}

function memberBlocks(
  context: PlanSequenceContext,
  loop: AgentPlanLoop,
  iteration: number,
  kind: PlanSequenceBlockKind,
): (member: AgentPlanLoopMember) => PlanSequenceBlock {
  return (member) => ({
    key: iterationKey(loop.id, iteration, member.id),
    nodeId: member.id,
    name: context.label(member),
    pass: iteration,
    isLoopPass: true,
    kind,
  });
}

/** The members of the running iteration that have not started yet. */
function iterationRest(
  context: PlanSequenceContext,
  loop: AgentPlanLoop,
  members: readonly AgentPlanLoopMember[],
  sureKind: PlanSequenceBlockKind,
): readonly PlanSequenceBlock[] {
  const iteration = context.loops.get(loop.id)?.iterations.at(-1);
  if (!iteration || iteration.endedAt !== null || !context.isActive) return [];
  return members.flatMap((member): PlanSequenceBlock[] => {
    const result = iteration.nodes.find((node) => node.id === member.id);
    if (!result || hasStepStarted(result) || result.status === "skipped")
      return [];
    return [
      {
        ...memberBlocks(context, loop, iteration.number, sureKind)(member),
        name: result.name,
        result,
      },
    ];
  });
}

/** The blocks of a loop that are still to come: the rest of its iteration, then its further iterations. */
function loopBlocks(
  context: PlanSequenceContext,
  loop: AgentPlanLoop,
  isUncertain: boolean,
): readonly PlanSequenceBlock[] {
  const record = context.loops.get(loop.id);
  const members = planLoopStepOrder(context.graph, loop);
  const sureKind = isUncertain ? "assumed" : "planned";
  const recorded = record?.iterations.length ?? 0;
  const outlook: PlanLoopOutlook =
    (record && startedLoopOutlook(record)) ??
    planLoopOutlook(context.graph, loop);
  const blocks = [...iterationRest(context, loop, members, sureKind)];
  for (let index = 1; index <= outlook.sure + outlook.assumed; index += 1) {
    const kind = index <= outlook.sure ? sureKind : "assumed";
    blocks.push(
      ...members.map(memberBlocks(context, loop, recorded + index, kind)),
    );
  }
  return blocks;
}

/** A block for the next start of an outer agent or script. */
function startBlock(
  context: PlanSequenceContext,
  node: AgentPlanNode,
  pass: number,
  kind: PlanSequenceBlockKind,
): PlanSequenceBlock {
  const step = context.results.get(node.id);
  return {
    key: startKey(node.id, pass),
    nodeId: node.id,
    name: step?.name ?? context.label(node),
    pass,
    isLoopPass: false,
    kind,
  };
}

function nodeOutlook(
  context: PlanSequenceContext,
  id: string,
  state: RoundState | undefined,
): readonly PlanSequenceBlock[] {
  const node = context.nodes.get(id);
  if (!node || !state || state.isDead) return [];
  if (node.type === "loop") return loopBlocks(context, node, state.isUncertain);
  const step = context.results.get(id);
  if (!isSequenceStep(node) || hasStepStarted(step)) return [];
  const kind = state.isUncertain ? "assumed" : "planned";
  const block = startBlock(context, node, startCount(step) + 1, kind);
  // The waiting record belongs to this round; a later round has none yet.
  return [step ? { ...block, result: step } : block];
}

/**
 * Whether a sender of the cycle's event has run or surely runs in this round.
 *
 * @remarks
 * Its result then starts the target again, unless the target reached the
 * limit of starts; the next round is therefore expected.
 */
function expectsAnotherRound(
  context: PlanSequenceContext,
  states: ReadonlyMap<string, RoundState>,
  cycle: PlanSequenceCycle,
): boolean {
  const target = context.results.get(cycle.targetId);
  if ((target?.activation ?? 1) >= PLAN_ACTIVATION_LIMIT) return false;
  return cycle.sourceIds.some((id) => {
    const step = context.results.get(id);
    if (step?.status === "running" || step?.status === "succeeded") return true;
    const state = states.get(id);
    return (
      step?.status === "waiting" &&
      !step.isBlocked &&
      state?.isDead === false &&
      !state.isUncertain
    );
  });
}

/**
 * The assumed next round of the first cycle whose event is expected.
 *
 * @param context - The run and its graph.
 * @param states - What the current round expects of each node.
 * @param planned - Nodes that already have a block in the current round.
 *
 * @remarks
 * The round is projected as a fresh one: its decisions are open again and
 * expected to pass, so the senders of the event drop out and the nodes behind
 * the passing branch follow once.
 */
function nextRoundBlocks(
  context: PlanSequenceContext,
  states: ReadonlyMap<string, RoundState>,
  planned: ReadonlySet<string>,
): readonly PlanSequenceBlock[] {
  const cycle = context.cycles.find((entry) =>
    expectsAnotherRound(context, states, entry),
  );
  if (!cycle) return [];
  const round = new Set([cycle.targetId, ...cycle.region]);
  const fresh = projectRound(
    context,
    new Map([...context.results].filter(([id]) => !round.has(id))),
  );
  return context.order.flatMap((id) => {
    const node = context.nodes.get(id);
    if (!node || !round.has(id) || !isSequenceStep(node)) return [];
    if (fresh.get(id)?.isDead !== false) return [];
    const step = context.results.get(id);
    const pass = startCount(step) + (planned.has(id) ? 1 : 0) + 1;
    return [startBlock(context, node, pass, "assumed")];
  });
}

/**
 * The executions of agents and scripts that are still to come.
 *
 * @remarks
 * Sure blocks follow from the plan and the decisions taken so far; assumed
 * blocks estimate what the run cannot know yet: the iterations a loop may
 * skip, the next check of a while loop, the branch of an open decision and the
 * next round of a cycle. A run that has ended expects nothing more, so its
 * outlook keeps only the nodes it planned and never reached.
 */
export function outlookSequenceBlocks(
  context: PlanSequenceContext,
): readonly PlanSequenceBlock[] {
  const states = projectRound(context, context.results);
  const current = context.order.flatMap((id) =>
    nodeOutlook(context, id, states.get(id)),
  );
  if (!context.isActive)
    return current.filter((block) => block.kind !== "assumed");
  const planned = new Set(current.map((block) => block.nodeId));
  return [...current, ...nextRoundBlocks(context, states, planned)];
}
