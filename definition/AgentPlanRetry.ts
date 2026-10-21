/** Stable provider failures for which a plan can wait without changing its model. */
export type AgentPlanRetryCode =
  | "provider_unreachable"
  | "provider_unavailable"
  | "provider_rate_limited"
  | "provider_quota_exhausted";

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
  readonly code: AgentPlanRetryCode;
}

/** Durable waiting state inside the existing session JSON; no separate job or model selection. */
export interface AgentPlanRetry {
  readonly state: "waiting" | "running" | "blocked" | "completed" | "cancelled";
  readonly reason:
    "transient" | "quota" | "reset_unknown" | "exhausted" | "unsafe";
  readonly nextAttemptAt: string | null;
  readonly resetAt: string | null;
  readonly attempts: readonly AgentPlanRetryAttempt[];
}

/** Ten retries follow the original attempt, never ten unbounded worker restarts. */
export const PLAN_MAXIMUM_RETRIES = 10;
