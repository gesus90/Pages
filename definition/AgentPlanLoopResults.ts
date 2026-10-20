import type { AgentPlanRun, AgentPlanStepResult } from "./AgentPlan";

/**
 * Every node result of a run: the outer nodes and the members of each loop iteration.
 *
 * @remarks
 * The records of the sessions of loop members live in the iterations, not in
 * the run's own steps; whatever must see every session of a run, such as the
 * cleanup check, reads them through this list.
 */
export function allPlanRunResults(
  run: Pick<AgentPlanRun, "steps" | "loops">,
): readonly AgentPlanStepResult[] {
  return [
    ...run.steps,
    ...(run.loops ?? []).flatMap((loop) =>
      loop.iterations.flatMap((iteration) => iteration.nodes),
    ),
  ];
}
