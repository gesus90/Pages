/** Stable provider failures for which a plan can wait without changing its model. */
export type AgentPlanRetryCode =
  | "provider_unreachable"
  | "provider_unavailable"
  | "provider_rate_limited"
  | "provider_quota_exhausted";

/** Technical ACP session or transport failures, which belong to the infrastructure class. */
export type AgentPlanSessionRetryCode =
  | "plan_acp_session_failed"
  | "plan_claude_acp_session_failed"
  | "opencode_acp_session_failed"
  | "antigravity_acp_session_failed"
  | "plan_runner_session_failed"
  | "acp_session_resume_failed";

/** The policies of records written before the blocker classes; read only. */
export type AgentPlanRetryPolicy = "provider" | "session";

/**
 * What a failed step needs, which alone decides how it goes on.
 *
 * @remarks
 * `harm` stops at once and a person decides. `form` goes back to the agent with
 * the concrete error. `infrastructure` continues on its own after a growing
 * wait. `open` gets repair rounds in the same step. The assignment of the error
 * codes lives in `AgentPlanBlockerRules`.
 */
export type AgentPlanBlockerClass = "harm" | "form" | "infrastructure" | "open";

/** How many automatic attempts follow the first failure of a class. */
export const PLAN_BLOCKER_RETRIES: Readonly<
  Record<AgentPlanBlockerClass, number>
> = { harm: 0, form: 2, infrastructure: 3, open: 2 };

/** The growing waits before the automatic attempts of an infrastructure failure. */
export const PLAN_INFRASTRUCTURE_RETRY_DELAYS = [
  10_000, 60_000, 300_000,
] as const;

/** Holds every attempt of today's classes and the eleven of a record written before them. */
export const PLAN_RETRY_HISTORY_LIMIT = 11;

/** Only a classified failure and an unambiguous UTC reset leave the provider boundary. */
export interface AgentProviderFailure {
  readonly code: AgentPlanRetryCode;
  readonly resetAt: string | null;
}

/** A failed attempt remains attributable after the next session replaces its live record. */
export interface AgentPlanRetryAttempt {
  readonly attemptId: string | null;
  readonly sessionId: string | null;
  readonly endedAt: string;
  /** Any code a step fails with; a code without a translation stays readable as it is. */
  readonly code: string;
  /** Absent in older records, whose class follows from the code. */
  readonly failureClass?: AgentPlanBlockerClass;
  /** What the acceptance found open, which the next attempt is told. */
  readonly issues?: readonly string[];
}

/** Why a failed step ended, in the words a person and a client read. */
export interface AgentPlanFailureStop {
  readonly failureClass: AgentPlanBlockerClass;
  /** Failed attempts of this class, the first one included. */
  readonly attempts: number;
  /** The attempts the class admits, the first one included. */
  readonly maximumAttempts: number;
  /** Every failed attempt of the node, of all classes. */
  readonly totalAttempts: number;
}

/** Durable waiting state inside the existing session JSON; no separate job or model selection. */
export interface AgentPlanRetry {
  /** Only in older records; they follow the blocker classes as well. */
  readonly policy?: AgentPlanRetryPolicy;
  /** The class of the newest failure; absent in older records. */
  readonly failureClass?: AgentPlanBlockerClass;
  readonly state: "waiting" | "running" | "blocked" | "completed" | "cancelled";
  readonly reason:
    | "transient"
    | "quota"
    | "repair"
    | "hard_stop"
    | "reset_unknown"
    | "exhausted"
    | "unsafe"
    | "closeout_unconfirmed"
    | "resume_unavailable"
    | "session_not_kept"
    | "remote_evidence_missing"
    | "effect_unknown"
    | "session"
    | "failed";
  readonly nextAttemptAt: string | null;
  readonly resetAt: string | null;
  readonly attempts: readonly AgentPlanRetryAttempt[];
  /** A tool-using or shared session must keep this native conversation across attempts. */
  readonly requiredResumeSessionId?: string;
}
