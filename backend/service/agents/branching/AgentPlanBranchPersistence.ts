import { z } from "zod";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { ActivePlanRun } from "../AgentPlanRunState";
import type { PlanBranchingState } from "./AgentPlanBranchState";

const BRANCH_STATE = Symbol("private-plan-branch-state");
const branchSchema = z.object({
  pending: z.array(
    z.object({
      targetId: z.string(),
      sourceId: z.string(),
      sourceActivation: z.number().int(),
      prompt: z.string().max(200_000),
    }),
  ),
  queued: z.array(z.string()),
  consumed: z.array(z.tuple([z.string(), z.string()])),
  prompts: z.array(z.tuple([z.string(), z.string().max(200_000)])),
});

/** Associates engine bookkeeping with its view without adding any public JSON field. */
export function bindPlanBranchState(active: ActivePlanRun): void {
  Object.defineProperty(active.view, BRANCH_STATE, {
    value: () => active.branching,
    enumerable: true,
    configurable: true,
  });
}

/** Serializes the private bookkeeping alongside the same transaction as the run view. */
export function storedPlanBranchState(
  run: AgentPlanRun & {
    readonly [BRANCH_STATE]?: () => PlanBranchingState | undefined;
  },
): unknown | null {
  const state = run[BRANCH_STATE]?.();
  return serializePlanBranchState(state);
}

/** Creates a JSON-safe copy for a recovery snapshot, without exposing engine state publicly. */
export function serializePlanBranchState(
  state: PlanBranchingState | undefined,
): unknown | null {
  return state
    ? {
        pending: state.pending,
        queued: [...state.queued],
        consumed: [...state.consumed],
        prompts: [...state.prompts],
      }
    : null;
}

/** Restores consumed edges and pending event prompts so completed work is never emitted twice. */
export function readPlanBranchState(input: unknown): PlanBranchingState {
  const stored = branchSchema.parse(input);
  return {
    pending: stored.pending,
    queued: new Set(stored.queued),
    consumed: new Map(stored.consumed),
    prompts: new Map(stored.prompts),
  };
}
