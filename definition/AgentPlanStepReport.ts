/** The operation of `report_step_result`; only the credential of a plan session is ever offered it. */
export const AGENT_STEP_REPORT_OPERATION = "run.step.report" as const;

/** How an agent ends its step: finished, or stopped for a person to decide. */
export const AGENT_STEP_REPORT_STATUSES = ["done", "blocked"] as const;

/** One todo as the agent reports it. */
export interface AgentPlanStepReportTodo {
  readonly id: string;
  readonly status: "done" | "open";
}

/** One acceptance criterion as the agent reports it. */
export interface AgentPlanStepReportCriterion {
  readonly id: string;
  readonly met: boolean;
  readonly evidence: string;
}

/**
 * The result of one attempt of a step, reported through `report_step_result`.
 *
 * @remarks
 * It replaces the `pages-report` text block of the final answer whenever both
 * exist. The business conditions stay the same for both ways.
 */
export interface AgentPlanStepReport {
  readonly status: (typeof AGENT_STEP_REPORT_STATUSES)[number];
  /** What a person reads about the outcome, and the output of an otherwise silent step. */
  readonly message: string;
  readonly todos: readonly AgentPlanStepReportTodo[];
  readonly criteria: readonly AgentPlanStepReportCriterion[];
  readonly decisions: readonly string[];
  readonly summary: string;
}

/** What a valid call answers: which attempt now holds the result. */
export interface AgentPlanStepReportReceipt {
  readonly runId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly status: AgentPlanStepReport["status"];
  /** Whether this call replaced an earlier result of the same attempt. */
  readonly replaced: boolean;
}
