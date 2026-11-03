import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { actualSequenceBlocks } from "./plan-step-sequence-actual";
import { outlookSequenceBlocks } from "./plan-step-sequence-outlook";
import { planSequenceContext } from "./plan-step-sequence-context";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanRun,
} from "@/definition/AgentPlan";
import type { PlanSequenceBlock } from "./plan-step-sequence-context";

export type {
  PlanSequenceBlock,
  PlanSequenceBlockKind,
} from "./plan-step-sequence-context";

/**
 * The numbered executions of a run: what ran, what is planned, what is assumed.
 *
 * @remarks
 * `position` is the number of the current block, 0 before any block is
 * current. `completed` counts the executions that succeeded. Both come from
 * the run's records, never from the outlook; only the total, the length of
 * `blocks`, contains planned and assumed executions, and `isEstimate` says
 * that it does contain assumed ones.
 */
export interface PlanStepSequence {
  readonly blocks: readonly PlanSequenceBlock[];
  readonly anchorKey: string | null;
  readonly position: number;
  readonly completed: number;
  readonly isEstimate: boolean;
}

/** The current block: a running execution, the frontier of a paused or blocked run, or the last one that ran. */
function anchorBlock(
  run: AgentPlanRun | null,
  actual: readonly PlanSequenceBlock[],
  outlook: readonly PlanSequenceBlock[],
): PlanSequenceBlock | undefined {
  if (!run) return undefined;
  if (!isActivePlanRun(run.status))
    return (
      actual.find((block) => block.result?.status === "failed") ?? actual.at(-1)
    );
  const frontier = run.pauseBoundary?.frontierStepIds ?? [];
  return (
    actual.find((block) => block.result?.status === "running") ??
    outlook.find(
      (block) =>
        block.result !== undefined &&
        (frontier.includes(block.nodeId) ||
          block.result.isBlocked ||
          block.result.status === "paused"),
    ) ??
    actual.at(-1)
  );
}

/** Keeps the first block of every key, so that no execution is shown twice. */
function uniqueBlocks(
  blocks: readonly PlanSequenceBlock[],
): readonly PlanSequenceBlock[] {
  const keys = new Set<string>();
  return blocks.filter((block) => {
    if (keys.has(block.key)) return false;
    keys.add(block.key);
    return true;
  });
}

/**
 * Numbers the executions of agents and scripts of a run, and estimates the rest.
 *
 * @param run - The run, or `null` for the outlook of a plan before it runs.
 * @param plan - The plan revision the run executes.
 * @param label - Names a node that has no record yet.
 *
 * @remarks
 * Only agents and scripts are steps. Start, End, decisions, stacks,
 * parameters, groups and loops order, repeat and choose them but are no step
 * of their own. Every start of a node and every loop iteration of a member is
 * a block of its own. The blocks that ran come first, in flow order, so an
 * estimate never moves the number of a block that ran; the planned and
 * assumed blocks follow and are recomputed from every new record of the run.
 */
export function planStepSequence(
  run: AgentPlanRun | null,
  plan: AgentPlanInput,
  label: (node: AgentPlanNode) => string,
): PlanStepSequence {
  const context = planSequenceContext(run, plan, label);
  const actual = actualSequenceBlocks(context);
  const known = new Set(actual.map((block) => block.key));
  const outlook = outlookSequenceBlocks(context).filter(
    (block) => !known.has(block.key),
  );
  const blocks = uniqueBlocks([...actual, ...outlook]);
  const anchor = anchorBlock(run, actual, outlook);
  return {
    blocks,
    anchorKey: anchor?.key ?? null,
    position: blocks.findIndex((block) => block.key === anchor?.key) + 1,
    completed: actual.filter((block) => block.result?.status === "succeeded")
      .length,
    isEstimate: outlook.some((block) => block.kind === "assumed"),
  };
}
