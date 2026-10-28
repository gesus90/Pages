const CLEANUP_KINDS = [
  "local_session",
  "local_script",
  "remote_attempt",
  "loop",
] as const;
const CLEANUP_FAILURE_REASONS = [
  "scan_access_denied",
  "scan_unavailable",
  "processes_remaining",
  "resource_cleanup_failed",
] as const;

/** A recorded resource whose original closeout still needs confirmation. */
export interface AgentPlanCleanupResource {
  readonly stepId: string;
  readonly kind: (typeof CLEANUP_KINDS)[number];
  /** Unknown means that the original attempt has no conclusive closeout record. */
  readonly closeout: "pending" | "failed" | "unknown";
}

/** A bounded reason a cleanup check could not prove the end of an owned resource. */
export interface AgentPlanCleanupFailure {
  readonly stepId: string;
  readonly kind: AgentPlanCleanupResource["kind"];
  readonly reason: (typeof CLEANUP_FAILURE_REASONS)[number];
}

/** Historical scan/cleanup evidence; it does not assert current reservation state. */
export interface AgentPlanCleanupFailureRecord extends AgentPlanCleanupFailure {
  readonly id: string;
  readonly createdAt: string;
  readonly planId: string;
  readonly runId: string;
  readonly planRevision: number;
  readonly recoveryRevision: number;
  readonly action: "release" | "restart" | "resume";
  /** Null when the historical resource cannot be assigned to one exact attempt. */
  readonly attemptId: string | null;
}

/** Reads only the bounded, public fields of a cleanup failure. */
export function readPlanCleanupFailure(
  input: unknown,
): AgentPlanCleanupFailure | null {
  if (typeof input !== "object" || input === null) return null;
  if (!("stepId" in input) || typeof input.stepId !== "string") return null;
  if (input.stepId.length === 0 || input.stepId.length > 4096) return null;
  if (!("kind" in input) || !("reason" in input)) return null;
  const kind = CLEANUP_KINDS.find((candidate) => candidate === input.kind);
  const reason = CLEANUP_FAILURE_REASONS.find(
    (candidate) => candidate === input.reason,
  );
  return kind && reason ? { stepId: input.stepId, kind, reason } : null;
}
