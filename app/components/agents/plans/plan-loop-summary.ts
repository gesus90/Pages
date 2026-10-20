import { planLoopParameterRuns } from "@/definition/AgentPlanLoopGraph";
import { PLAN_LOOP_RUNS_BINDING } from "@/definition/AgentPlanLoop";

import type { TFunction } from "i18next";
import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";

/** The parameter node that feeds the count of a loop, if the loop names one that exists. */
export function planLoopParameterNode(
  draft: AgentPlanInput,
  loop: AgentPlanLoop,
): Extract<AgentPlanInput["nodes"][number], { type: "parameter" }> | null {
  const binding = loop.bindings[PLAN_LOOP_RUNS_BINDING];
  if (binding?.kind !== "source") return null;
  const node = draft.nodes.find((entry) => entry.id === binding.nodeId);
  return node?.type === "parameter" ? node : null;
}

/**
 * The number of iterations the loop would run now, or `null` for an unusable source.
 *
 * @remarks
 * A bound parameter counts only with a whole number from 1 to 999; nothing
 * falls back to the saved number.
 */
export function planLoopEffectiveRuns(
  draft: AgentPlanInput,
  loop: AgentPlanLoop,
): number | null {
  if (loop.runsSource === "value") return loop.runs;
  return planLoopParameterRuns(planLoopParameterNode(draft, loop) ?? undefined);
}

/** The recorded state of a loop in a run, if the run has one. */
export function planLoopRunOf(
  run: AgentPlanRun | null,
  loopId: string,
): AgentPlanLoopRun | undefined {
  return run?.loops?.find((entry) => entry.id === loopId);
}

/** The short summary of the header: the count mode and the number of runs. */
export function planLoopSummary(
  draft: AgentPlanInput,
  loop: AgentPlanLoop,
  translate: TFunction,
): string {
  const runs = planLoopEffectiveRuns(draft, loop);
  const mode = translate(`plans.loops.mode.${loop.countMode}Short`);
  return runs === null
    ? translate("plans.loops.summaryUnresolved", { mode })
    : translate("plans.loops.summary", { mode, count: runs });
}

/** `2 / 3` for the iteration a running loop is in; absent before it started. */
export function planLoopProgress(
  record: AgentPlanLoopRun | undefined,
): string | null {
  if (!record?.count) return null;
  const current = Math.min(record.iterations.length, record.count.effective);
  return `${Math.max(current, 1)} / ${record.count.effective}`;
}

/**
 * The result a loop member shows on its card: that of its newest iteration.
 *
 * @remarks
 * Earlier iterations keep their own results in the loop's panel; a card shows
 * what the member did last, never a mix of iterations.
 */
export function planLoopMemberResult(
  run: AgentPlanRun | null,
  memberId: string,
): AgentPlanStepResult | undefined {
  for (const loop of run?.loops ?? [])
    for (const iteration of [...loop.iterations].reverse()) {
      const node = iteration.nodes.find((entry) => entry.id === memberId);
      if (node) return node;
    }
  return undefined;
}
