import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanLoopIteration } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanStepSnapshot } from "../AgentPlanSnapshot";

/** What one run of a loop member sees: its own copy of the node and the results it may read. */
export interface LoopStepInput {
  readonly step: AgentPlanStepSnapshot;
  /** The results of the current iteration, plus the previous iteration's results the inputs name. */
  readonly results: readonly AgentPlanStepResult[];
  /** Inputs that took the previous iteration's result, by name; empty in the first iteration. */
  readonly carried: readonly string[];
}

function previousId(stepId: string): string {
  return `previous:${stepId}`;
}

/**
 * Builds the node a member runs in one iteration.
 *
 * @param base - The frozen member.
 * @param current - The results of the current iteration so far.
 * @param previous - The previous iteration, absent in the first.
 *
 * @remarks
 * A binding to the previous iteration becomes an ordinary result binding to
 * that single earlier result, so only the newest result reaches the turn;
 * nothing accumulates. Where there is no earlier result, the first iteration
 * or an earlier node that produced no text, the binding and its pending
 * placeholder are dropped and the input takes its own default, which the
 * plan check requires for such an input. No earlier result is ever invented.
 */
export function loopStepInput(
  base: AgentPlanStepSnapshot,
  current: readonly AgentPlanStepResult[],
  previous: AgentPlanLoopIteration | undefined,
): LoopStepInput {
  const bindings: Record<string, (typeof base.step.bindings)[string]> = {};
  const values: Record<string, AgentParameterValue | null> = {
    ...base.prepared.parameters.values,
  };
  const results = [...current];
  const carried: string[] = [];
  for (const [name, binding] of Object.entries(base.step.bindings)) {
    if (binding.kind !== "previous") {
      bindings[name] = binding;
      continue;
    }
    const earlier = previous?.nodes.find((node) => node.id === binding.stepId);
    if (earlier?.status !== "succeeded" || earlier.output === null) {
      delete values[name];
      continue;
    }
    results.push({
      id: previousId(binding.stepId),
      name: earlier.name,
      status: "succeeded",
      isBlocked: false,
      cancellation: "none",
      output: earlier.output,
      error: null,
    });
    bindings[name] = { kind: "result", stepId: previousId(binding.stepId) };
    carried.push(name);
  }
  return {
    step: {
      ...base,
      step: { ...base.step, bindings },
      prepared: {
        ...base.prepared,
        parameters: { ...base.prepared.parameters, values },
      },
    },
    results,
    carried,
  };
}

/** The run view a member's start reads: the run with this iteration's results as its steps. */
export function loopRunView(
  run: AgentPlanRun,
  results: readonly AgentPlanStepResult[],
): AgentPlanRun {
  return { ...run, steps: results };
}
