import { loopRunView, loopStepInput } from "./AgentPlanLoopStep";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanStepSnapshot } from "../AgentPlanSnapshot";

/** Locates a stored attempt's enclosing iteration, including a group whose record has only a group link. */
export function storedPlanIteration(
  run: AgentPlanRun,
  result: AgentPlanStepResult,
): number | undefined {
  const attemptId = result.session?.attemptId;
  if (!attemptId) return undefined;
  for (const loop of run.loops ?? [])
    for (const iteration of loop.iterations)
      if (iteration.nodes.some((node) => node.session?.attemptId === attemptId))
        return iteration.number;
  return result.session?.loop?.iteration;
}

/** Rebuilds the original loop-member view and previous-result bindings for authorized future turns. */
export function storedPlanNodeInput(
  run: AgentPlanRun,
  step: AgentPlanStepSnapshot,
  result: AgentPlanStepResult,
): { readonly run: AgentPlanRun; readonly step: AgentPlanStepSnapshot } {
  const attemptId = result.session?.attemptId;
  for (const loop of run.loops ?? []) {
    const iteration = loop.iterations.find((entry) =>
      entry.nodes.some(
        (node) =>
          attemptId !== undefined && node.session?.attemptId === attemptId,
      ),
    );
    if (!iteration) continue;
    const input = loopStepInput(
      step,
      iteration.nodes,
      loop.iterations.find((entry) => entry.number === iteration.number - 1),
    );
    return { run: loopRunView(run, input.results), step: input.step };
  }
  return { run, step };
}
