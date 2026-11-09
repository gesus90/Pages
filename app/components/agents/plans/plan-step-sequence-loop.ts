import {
  PLAN_LOOP_RUNS_BINDING,
  PLAN_LOOP_WHILE_BINDING,
  isPlanLoopConditionActive,
  planLoopMembers,
  planLoopMode,
} from "@/definition/AgentPlanLoop";
import { planLoopStages } from "@/definition/AgentPlanLoopStages";
import {
  planLoopBoundRuns,
  planLoopParameterBoolean,
} from "@/definition/AgentPlanLoopGraph";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type {
  AgentPlanLoop,
  AgentPlanLoopMember,
} from "@/definition/AgentPlanLoop";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";

/**
 * The iterations a loop is still expected to run, split by certainty.
 *
 * @remarks
 * `sure` iterations follow from a known count; `assumed` ones are an estimate
 * that the run may still prove wrong, such as the next check of a while loop.
 */
export interface PlanLoopOutlook {
  readonly sure: number;
  readonly assumed: number;
}

const NO_ITERATION: PlanLoopOutlook = { sure: 0, assumed: 0 };

/**
 * The agents and scripts of one iteration in the order the iteration runs them.
 *
 * @param graph - The plan the run executes, its outer groups expanded.
 * @param loop - The loop.
 *
 * @remarks
 * Stacks the loop triggers order the members around them but are no step of
 * their own; groups inside the loop contribute their agents.
 */
export function planLoopStepOrder(
  graph: Pick<AgentPlanInput, "nodes" | "edges">,
  loop: AgentPlanLoop,
): readonly AgentPlanLoopMember[] {
  const members = new Map(
    planLoopMembers(loop).map((member) => [member.id, member]),
  );
  return planLoopStages(graph, loop)
    .flat()
    .flatMap((id) => {
      const member = members.get(id);
      return member ? [member] : [];
    });
}

/** The boolean a while loop reads before its first iteration, or `null` while unknown. */
function firstWhileCheck(
  graph: Pick<AgentPlanInput, "nodes">,
  loop: AgentPlanLoop,
): boolean | null {
  const binding = loop.bindings[PLAN_LOOP_WHILE_BINDING];
  if (binding?.kind !== "source") return null;
  return planLoopParameterBoolean(
    graph.nodes.find((node) => node.id === binding.nodeId),
  );
}

/** The outlook of a while loop whose next check is known, unknown or negative. */
function whileOutlook(check: boolean | null): PlanLoopOutlook {
  if (check === false) return NO_ITERATION;
  // Only the next iteration is assumed; no unbounded future is filled in.
  return check ? { sure: 1, assumed: 1 } : { sure: 0, assumed: 1 };
}

/**
 * The iterations of a loop that has not started, read from the saved plan.
 *
 * @remarks
 * A count that cannot be read before the run, such as one bound to a result,
 * is assumed to be one iteration. A `max` loop with an active end condition
 * may stop after any iteration, so only its first iteration is sure.
 */
export function planLoopOutlook(
  graph: Pick<AgentPlanInput, "nodes">,
  loop: AgentPlanLoop,
): PlanLoopOutlook {
  if (planLoopMode(loop) === "while")
    return whileOutlook(firstWhileCheck(graph, loop));
  const runs =
    loop.runsSource === "value"
      ? loop.runs
      : planLoopBoundRuns(loop.bindings[PLAN_LOOP_RUNS_BINDING], graph);
  if (runs === null) return { sure: 0, assumed: 1 };
  return isPlanLoopConditionActive(loop)
    ? { sure: Math.min(1, runs), assumed: Math.max(0, runs - 1) }
    : { sure: runs, assumed: 0 };
}

/** Whether the loop has ended, regularly or not, so that no further iteration follows. */
function hasLoopEnded(record: AgentPlanLoopRun): boolean {
  return (
    record.completion !== null ||
    record.status === "succeeded" ||
    record.status === "failed" ||
    record.status === "cancelled" ||
    record.status === "skipped"
  );
}

/**
 * The iterations a started loop is still expected to run after its recorded ones.
 *
 * @param record - The loop's state in the run.
 * @returns The outlook, or `null` before the loop resolved its count.
 *
 * @remarks
 * The count the loop resolved once is binding. A while loop records each
 * check; without a check for the next iteration only that iteration is
 * assumed, and a `false` check ends the outlook at once.
 */
export function startedLoopOutlook(
  record: AgentPlanLoopRun,
): PlanLoopOutlook | null {
  if (hasLoopEnded(record)) return NO_ITERATION;
  const count = record.count;
  if (!count) return null;
  const recorded = record.iterations.length;
  if (count.source === "while") {
    if (recorded >= count.effective) return NO_ITERATION;
    const check = record.whileChecks?.find(
      (entry) => entry.before === recorded + 1,
    );
    return whileOutlook(check?.value ?? null);
  }
  const rest = Math.max(0, count.effective - recorded);
  return record.condition?.isActive
    ? { sure: 0, assumed: rest }
    : { sure: rest, assumed: 0 };
}
