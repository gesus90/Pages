import { planPauseGate } from "./AgentPlanPauseGate";

import type { StepRunControl } from "./AgentPlanStepRunner";
import type { PreparedPlanStep } from "./AgentPlanStepStart";

/** Rechecks live authorization before claiming dispatch; a drained step never replays. */
export function guardPlanStepStart(
  node: {
    hasStarted: boolean;
    readonly control: StepRunControl;
    readonly run?: { readonly id: string };
  },
  prepared: PreparedPlanStep,
): PreparedPlanStep {
  return {
    ...prepared,
    input: {
      ...prepared.input,
      beforeStart: async () => {
        if (node.run)
          await planPauseGate(node.run.id).wait(node.control.signal);
        await prepared.input.beforeStart?.();
        node.control.signal.throwIfAborted();
        node.control.claimStart?.();
        node.hasStarted = true;
      },
    },
  };
}
