import { planLoopStepOrder } from "./plan-step-sequence-loop";
import {
  activationResult,
  hasStepStarted,
  isSequenceStep,
  iterationKey,
  startKey,
} from "./plan-step-sequence-context";

import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  PlanSequenceBlock,
  PlanSequenceContext,
} from "./plan-step-sequence-context";

/** The recorded starts of an outer agent or script: its earlier ones first, then the current one. */
function startBlocks(step: AgentPlanStepResult): readonly PlanSequenceBlock[] {
  const earlier = (step.history ?? []).map((entry): PlanSequenceBlock => ({
    key: startKey(step.id, entry.activation),
    nodeId: step.id,
    name: step.name,
    pass: entry.activation,
    isLoopPass: false,
    kind: "actual",
    result: activationResult(step, entry),
  }));
  if (!hasStepStarted(step)) return earlier;
  const pass = step.activation ?? earlier.length + 1;
  return [
    ...earlier,
    {
      key: startKey(step.id, pass),
      nodeId: step.id,
      name: step.name,
      pass,
      isLoopPass: false,
      kind: "actual",
      result: step,
    },
  ];
}

/** The members every recorded iteration of a loop started, iteration by iteration. */
function iterationBlocks(
  context: PlanSequenceContext,
  loop: AgentPlanLoop,
): readonly PlanSequenceBlock[] {
  const record = context.loops.get(loop.id);
  if (!record) return [];
  const members = planLoopStepOrder(context.graph, loop);
  return record.iterations.flatMap((iteration) =>
    members.flatMap((member): PlanSequenceBlock[] => {
      const result = iteration.nodes.find((node) => node.id === member.id);
      if (!result || !hasStepStarted(result)) return [];
      return [
        {
          key: iterationKey(loop.id, iteration.number, member.id),
          nodeId: member.id,
          name: result.name,
          pass: iteration.number,
          isLoopPass: true,
          kind: "actual",
          result,
        },
      ];
    }),
  );
}

function nodeBlocks(
  context: PlanSequenceContext,
  id: string,
): readonly PlanSequenceBlock[] {
  const node = context.nodes.get(id);
  if (node?.type === "loop") return iterationBlocks(context, node);
  const step = context.results.get(id);
  return isSequenceStep(node) && step ? startBlocks(step) : [];
}

/** Interleaves the starts of the nodes of a cycle round by round: each node's k-th start joins round k. */
function roundBlocks(
  starts: readonly (readonly PlanSequenceBlock[])[],
): readonly PlanSequenceBlock[] {
  const rounds = Math.max(0, ...starts.map((entries) => entries.length));
  const blocks: PlanSequenceBlock[] = [];
  for (let round = 0; round < rounds; round += 1)
    for (const entries of starts) {
      const block = entries[round];
      if (block) blocks.push(block);
    }
  return blocks;
}

/**
 * Executions the run recorded for nodes the graph does not know.
 *
 * @remarks
 * Only a run of another revision than the graph has such records; an
 * execution with a session or a script process is kept rather than hidden.
 * The derived summary of a group is no execution of its own.
 */
function unknownBlocks(
  context: PlanSequenceContext,
  covered: ReadonlySet<string>,
): readonly PlanSequenceBlock[] {
  const steps = [...context.results.values()];
  const groups = new Set(steps.flatMap((step) => step.groupId ?? []));
  return steps
    .filter(
      (step) =>
        !covered.has(step.id) &&
        !context.nodes.has(step.id) &&
        !groups.has(step.id) &&
        (step.session ?? step.script) !== undefined,
    )
    .flatMap(startBlocks);
}

/**
 * Every execution of an agent or script the run recorded as started.
 *
 * @remarks
 * The blocks follow the flow order of the plan. A loop contributes its
 * members once per recorded iteration. The nodes of a cycle are interleaved
 * round by round: a node's earlier starts come from its history, and nodes
 * of the round that ran fewer times than the target are taken to have run
 * in the first rounds, as only an unfinished round can send the event that
 * starts the next one. The blocks are derived from the run's current record
 * alone, so a repeated, late or resumed update yields the same blocks.
 */
export function actualSequenceBlocks(
  context: PlanSequenceContext,
): readonly PlanSequenceBlock[] {
  const visited = new Set<string>();
  const blocks: PlanSequenceBlock[] = [];
  for (const id of context.order) {
    if (visited.has(id)) continue;
    const cycle = context.cycles.find((entry) => entry.targetId === id);
    const ids = cycle ? cycle.body : [id];
    for (const entry of ids) visited.add(entry);
    blocks.push(
      ...(cycle
        ? roundBlocks(ids.map((entry) => nodeBlocks(context, entry)))
        : nodeBlocks(context, id)),
    );
  }
  return [...blocks, ...unknownBlocks(context, visited)];
}
