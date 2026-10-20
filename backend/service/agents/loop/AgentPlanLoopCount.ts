import { AgentError } from "@/backend/error/AgentErrors";
import { planLoopParameterRuns } from "@/definition/AgentPlanLoopGraph";
import {
  PLAN_LOOP_RUNS_BINDING,
  isPlanLoopRuns,
} from "@/definition/AgentPlanLoop";

import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanLoopCount } from "@/definition/AgentPlanLoopRun";

/**
 * Resolves the number of iterations of a loop once, before its first iteration.
 *
 * @param loop - The frozen loop.
 * @param plan - The frozen plan, which holds the parameter nodes.
 * @returns The source, the effective number and the mode; the caller stores
 * them with the run, so a later change of the parameter cannot move them.
 * @throws {AgentError} `plan_loop_runs_unavailable` when the chosen parameter
 * node is gone, `plan_loop_runs_invalid` when a value is no whole number
 * from 1 to 999. A parameter text counts only as plain decimal digits; no
 * value is rounded, cut or replaced by the saved number.
 */
export function resolveLoopCount(
  loop: AgentPlanLoop,
  plan: AgentPlan,
): AgentPlanLoopCount {
  if (loop.runsSource === "value") {
    if (!isPlanLoopRuns(loop.runs))
      throw new AgentError("plan_loop_runs_invalid");
    return {
      source: "value",
      parameterId: null,
      effective: loop.runs,
      mode: loop.countMode,
    };
  }
  const binding = loop.bindings[PLAN_LOOP_RUNS_BINDING];
  const source =
    binding?.kind === "source"
      ? plan.nodes.find((node) => node.id === binding.nodeId)
      : undefined;
  if (source?.type !== "parameter")
    throw new AgentError("plan_loop_runs_unavailable");
  const runs = planLoopParameterRuns(source);
  if (runs === null) throw new AgentError("plan_loop_runs_invalid");
  return {
    source: "parameter",
    parameterId: source.id,
    effective: runs,
    mode: loop.countMode,
  };
}
