import { AgentError } from "@/backend/error/AgentErrors";
import { planLoopParameterRuns } from "@/definition/AgentPlanLoopGraph";
import {
  PLAN_LOOP_RUNS_BINDING,
  PLAN_LOOP_WHILE_BINDING,
  PLAN_LOOP_WHILE_LIMIT,
  isPlanLoopBoundRuns,
  isPlanLoopRuns,
  planLoopMode,
} from "@/definition/AgentPlanLoop";

import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanLoopCount } from "@/definition/AgentPlanLoopRun";

/** The count of a loop bound to a parameter or to the count output of a stack. */
function boundCount(loop: AgentPlanLoop, plan: AgentPlan): AgentPlanLoopCount {
  const binding = loop.bindings[PLAN_LOOP_RUNS_BINDING];
  if (binding?.kind === "stack" && binding.output === "count") {
    const stack = plan.nodes.find((node) => node.id === binding.stackId);
    if (stack?.type !== "stack")
      throw new AgentError("plan_loop_runs_unavailable");
    if (!isPlanLoopBoundRuns(stack.entries.length))
      throw new AgentError("plan_loop_runs_invalid");
    return {
      source: "stack",
      parameterId: stack.id,
      effective: stack.entries.length,
      mode: loop.countMode,
    };
  }
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

/**
 * Resolves the number of iterations of a loop once, before its first iteration.
 *
 * @param loop - The frozen loop.
 * @param plan - The frozen plan, which holds the parameter and stack nodes.
 * @returns The source, the effective number and the mode; the caller stores
 * them with the run, so a later change of the parameter, or of what is left
 * in a stack, cannot move them.
 * @throws {AgentError} `plan_loop_runs_unavailable` when the bound parameter
 * or stack is gone, `plan_loop_runs_invalid` when a value is no whole number
 * from 1 to 999, or from 0 to 999 for a bound value. A parameter text counts
 * only as plain decimal digits; no value is rounded, cut or replaced by the
 * saved number.
 *
 * @remarks
 * A while loop counts nothing: it stores its upper limit, and its boolean
 * decides before every iteration whether one runs.
 */
export function resolveLoopCount(
  loop: AgentPlanLoop,
  plan: AgentPlan,
): AgentPlanLoopCount {
  if (planLoopMode(loop) === "while") {
    const binding = loop.bindings[PLAN_LOOP_WHILE_BINDING];
    return {
      source: "while",
      parameterId: binding?.kind === "source" ? binding.nodeId : null,
      effective: PLAN_LOOP_WHILE_LIMIT,
      mode: "max",
    };
  }
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
  return boundCount(loop, plan);
}
