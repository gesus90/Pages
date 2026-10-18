/** Stable scheduler boundary captured only after all dispatched work has drained. */
export interface AgentPlanPauseBoundary {
  readonly pausedAt: string;
  readonly completedStepIds: readonly string[];
  readonly pendingStepIds: readonly string[];
  /** Every ready branch is required; deleting a later optional node is a graph edit. */
  readonly frontierStepIds: readonly string[];
}

/** The adopted plan revision; the original run revision and snapshot never change. */
export interface AgentPlanContinuation {
  readonly version: number;
  readonly planRevision: number;
  readonly adoptedAt: string;
}
