import { PLAN_JUMP_DEFAULT_MINUTES } from "@/definition/AgentPlanJump";

import type { AgentPlanPosition } from "@/definition/AgentPlan";
import type {
  AgentPlanJumpIn,
  AgentPlanJumpOut,
  AgentPlanSignal,
} from "@/definition/AgentPlanJump";

/** The identity and the place of a node that is created. */
type PlanNodeBase = AgentPlanPosition & { readonly id: string };

/**
 * A new calling Jump: no target yet, it waits for the end of the call for an hour.
 * @param base - The identifier and the position of the node.
 */
export function newPlanJumpOut(base: PlanNodeBase): AgentPlanJumpOut {
  return {
    ...base,
    type: "jump",
    direction: "out",
    target: null,
    wait: "completion",
    timeout: { kind: "minutes", minutes: PLAN_JUMP_DEFAULT_MINUTES },
    workspace: "own",
    inputs: [],
    returns: [],
    bindings: {},
  };
}

/**
 * A new receiving Jump: released for calls and without declared inputs.
 * @param base - The identifier and the position of the node.
 * @param name - The display name of the entry.
 */
export function newPlanJumpIn(
  base: PlanNodeBase,
  name: string,
): AgentPlanJumpIn {
  return {
    ...base,
    type: "jump",
    direction: "in",
    name,
    isEnabled: true,
    inputs: [],
  };
}

/**
 * A new signal without a payload.
 * @param base - The identifier and the position of the node.
 */
export function newPlanSignal(base: PlanNodeBase): AgentPlanSignal {
  return { ...base, type: "signal", signalName: "signal", bindings: {} };
}
