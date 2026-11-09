/** The operation of `update_step_progress`; only the credential of a plan session is ever offered it. */
export const AGENT_STEP_PROGRESS_OPERATION = "run.step.progress" as const;

/** Where one todo of a step stands while the turn runs. */
export const AGENT_STEP_PROGRESS_STATUSES = ["open", "active", "done"] as const;

/** The longest activity line Pages keeps. */
export const AGENT_STEP_ACTIVITY_LENGTH = 200;

/** One todo as the agent reports its live state. */
export interface AgentPlanStepProgressTodo {
  readonly id: string;
  readonly status: (typeof AGENT_STEP_PROGRESS_STATUSES)[number];
}

/**
 * The last live progress of a step in a run (PAGE-284).
 *
 * @remarks
 * It survives further attempts of the same run, so a new attempt starts from
 * the last reported state. It never decides the step: `report_step_result`
 * stays the binding result.
 */
export interface AgentPlanStepLiveProgress {
  /** The attempt that reported last. */
  readonly attemptId: string;
  /** Every todo the agent reported so far, in the order of the contract. */
  readonly todos: readonly AgentPlanStepProgressTodo[];
  /** What the agent does now, in one short line; `null` without one. */
  readonly activity: string | null;
  readonly updatedAt: string;
}

/** What a valid call answers: the stored progress of the step. */
export interface AgentPlanStepProgressReceipt {
  readonly runId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly todos: readonly AgentPlanStepProgressTodo[];
  readonly activity: string | null;
}
