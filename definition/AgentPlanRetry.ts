/** Stable provider failures for which a plan can wait without changing its model. */
export type AgentPlanRetryCode =
  | "provider_unreachable"
  | "provider_unavailable"
  | "provider_rate_limited"
  | "provider_quota_exhausted";

/** Technical ACP session or transport failures that are retried at most three times. */
export type AgentPlanSessionRetryCode =
  | "plan_acp_session_failed"
  | "plan_claude_acp_session_failed"
  | "opencode_acp_session_failed"
  | "antigravity_acp_session_failed"
  | "acp_session_resume_failed";

/** A retry policy is fixed by the first classified failure of one attempt sequence. */
export type AgentPlanRetryPolicy = "provider" | "session";

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
  readonly code: AgentPlanRetryCode | AgentPlanSessionRetryCode;
}

/** Durable waiting state inside the existing session JSON; no separate job or model selection. */
export interface AgentPlanRetry {
  /** Absent in older records, which follow the provider policy. */
  readonly policy?: AgentPlanRetryPolicy;
  readonly state: "waiting" | "running" | "blocked" | "completed" | "cancelled";
  readonly reason:
    | "transient"
    | "quota"
    | "reset_unknown"
    | "exhausted"
    | "unsafe"
    | "session"
    | "failed";
  readonly nextAttemptAt: string | null;
  readonly resetAt: string | null;
  readonly attempts: readonly AgentPlanRetryAttempt[];
}

/** Ten retries follow the original attempt, never ten unbounded worker restarts. */
export const PLAN_MAXIMUM_RETRIES = 10;

/** A technical session failure gets exactly three total attempts including the first. */
export const PLAN_SESSION_MAXIMUM_ATTEMPTS = 3;

/** Every technical session attempt waits at least ten seconds after the failure. */
export const PLAN_SESSION_RETRY_DELAY_MILLISECONDS = 10_000;
