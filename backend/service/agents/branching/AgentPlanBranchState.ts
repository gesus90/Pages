/** A result that waits to start the node behind an event edge again. */
export interface PendingPlanEvent {
  readonly targetId: string;
  readonly sourceId: string;
  /** Which start of the source produced the result. */
  readonly sourceActivation: number;
  /** The result as a prompt, with its report removed; possibly empty. */
  readonly prompt: string;
}

/**
 * The live bookkeeping of decisions and events of one run.
 *
 * @remarks
 * Only the scheduler changes it, under its serial queue. It is not part of the
 * stored run: after a restart nothing runs again by itself, so nothing has to
 * be rebuilt from it.
 */
export interface PlanBranchingState {
  /** Results waiting for their target, in the order they arrived. */
  readonly pending: PendingPlanEvent[];
  /** `source#start>target` of every result that was queued, so a repeat is ignored. */
  readonly queued: Set<string>;
  /** `source#start` of the boolean result each decision evaluated last. */
  readonly consumed: Map<string, string>;
  /** The prompt of the event that started a node again, until that start has settled. */
  readonly prompts: Map<string, string>;
}

/** Creates the bookkeeping of a run that has none yet. */
export function newPlanBranchingState(): PlanBranchingState {
  return {
    pending: [],
    queued: new Set(),
    consumed: new Map(),
    prompts: new Map(),
  };
}
