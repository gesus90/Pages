import type { AgentPlanAgentTodoList } from "./AgentPlanAgentTodos.js";
import type { AgentPlanStepExecution } from "./AgentPlanExecution.js";
import type { AgentPlanAutomaticResume } from "./AgentPlanRecoveryEntry.js";
import type {
  AgentPlanBlockerClass,
  AgentPlanFailureStop,
  AgentPlanRetry,
  AgentPlanRetryAttempt,
} from "./AgentPlanRetry.js";
import type { AgentRunErrorFields } from "./AgentRunDiagnosis.js";
import type {
  AgentPlanRunStatus,
  AgentPlanRunSummary,
} from "./AgentPlanOperations.js";

/** One page of the runs of a plan, in the requested order of their start. */
export interface AgentPlanRunList {
  readonly planId: string;
  readonly order: "newest" | "oldest";
  readonly runs: readonly AgentPlanRunSummary[];
  readonly total: number;
  readonly nextCursor: string | null;
  readonly hiddenFields: readonly string[];
}

/** The state of one node in a run. */
export interface AgentPlanRunStepEntry extends Partial<AgentRunErrorFields> {
  readonly execution?: AgentPlanStepExecution;
  readonly attemptId?: string;
  readonly stepId: string;
  readonly name: string;
  readonly status: "waiting" | "skipped" | AgentPlanRunStatus;
  /** A disabled script skipped this node; status is succeeded. */
  readonly skipped?: boolean;
  readonly isBlocked: boolean;
  /** A failed or cancelled predecessor that prevented this node from running. */
  readonly blockedByStepId?: string;
  readonly error: string | null;
  /** Diagnostic progress, independent of execution status; `rejected` is historical. */
  readonly verdict: "accepted" | "open" | "rejected" | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  /** Whether {@link AgentPlanReport} has something for this node. */
  readonly hasReport: boolean;
  /** The last TODO list the CLI reported in this node's attempt; absent when it reported none (PAGE-306). */
  readonly agentTodos?: AgentPlanAgentTodoList;
  /** Why a failed node stopped: the class of its failure and its attempts. */
  readonly failureStop?: AgentPlanFailureStop;
  /** Persisted automatic retry state, for active waits and finished histories. */
  readonly retry?: {
    readonly failureClass: AgentPlanBlockerClass;
    readonly state: AgentPlanRetry["state"];
    readonly reason: AgentPlanRetry["reason"];
    /** Failed attempts of this class so far. */
    readonly attemptsFailed: number;
    /** Total attempts the class admits, the first attempt included. */
    readonly maximumAttempts: number;
    readonly nextAttemptAt: string | null;
    readonly resetAt: string | null;
    readonly lastError: AgentPlanRetryAttempt["code"] | null;
    readonly attempts: readonly Pick<
      AgentPlanRetryAttempt,
      "attemptId" | "endedAt" | "code" | "failureClass" | "issues"
    >[];
  };
}

/** One run with the state of its nodes. */
export interface AgentPlanRunDetail
  extends AgentPlanRunSummary, Partial<AgentRunErrorFields> {
  /** The first step that failed, when the run failed at a step. */
  readonly failedStepId?: string | null;
  readonly planRevision: number;
  /** ISO 8601 time the last node ended, `null` while the run is active. */
  readonly endedAt: string | null;
  readonly stopRequested: boolean;
  /** Set for a run a server restart interrupted: whether it continues on its own, or why not. */
  readonly automaticResume?: AgentPlanAutomaticResume;
  readonly steps: readonly AgentPlanRunStepEntry[];
  readonly continuationVersion?: number;
  readonly appliedPlanRevision?: number;
  readonly loops?: readonly {
    readonly loopId: string;
    readonly status: string;
    readonly completion: string | null;
    readonly cleanup: string;
    readonly iterations: readonly {
      readonly iteration: number;
      readonly status: string;
      readonly steps: readonly AgentPlanRunStepEntry[];
    }[];
  }[];
}

export interface AgentPlanRunRead {
  readonly run: AgentPlanRunDetail;
  readonly hiddenFields: readonly string[];
}

/** The report of one node of a run; `runId` and `stepId` name exactly where it belongs. */
export interface AgentPlanReport extends Partial<AgentRunErrorFields> {
  readonly loopId?: string;
  readonly iteration?: number;
  readonly runId: string;
  readonly planId: string;
  readonly stepId: string;
  readonly name: string;
  readonly status: AgentPlanRunStepEntry["status"];
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  /** The final, redacted result text of the node. */
  readonly output: string | null;
  /** Whether display filtering changed or shortened the stored output. */
  readonly isOutputFiltered: boolean;
  readonly error: string | null;
  /** A failed or cancelled predecessor, when the node did not run because of it. */
  readonly blockedByStepId?: string;
  readonly verdict: "accepted" | "open" | "rejected" | null;
  readonly summary: string | null;
  readonly todos: readonly {
    readonly id: string;
    readonly text: string;
    readonly status: "done" | "open" | "missing";
  }[];
  readonly criteria: readonly {
    readonly id: string;
    readonly text: string;
    readonly met: boolean;
    readonly evidence: string;
  }[];
  readonly decisions: readonly string[];
  readonly issues: readonly string[];
  /**
   * The last TODO list the CLI reported as a structured plan in this node's
   * attempt, with identifier, text, status and time of the last change;
   * `null` when it reported none (PAGE-306). Unlike `todos`, which holds the
   * contract todos of the closing report, it is the agent's own list.
   */
  readonly agentTodos: AgentPlanAgentTodoList | null;
}

/** The reports of a run, all assigned to it. */
export interface AgentPlanReportList {
  readonly run: AgentPlanRunSummary;
  readonly reports: readonly AgentPlanReport[];
  readonly hiddenFields: readonly string[];
}
