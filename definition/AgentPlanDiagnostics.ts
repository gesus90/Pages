import type { AgentPlanStepExecution } from "./AgentPlanExecution.js";
import type { AgentPlanRetryAttempt } from "./AgentPlanRetry.js";

/** A recorded stream, with its completeness stated independently of its text. */
export interface AgentPlanDiagnosticStream {
  readonly text: string | null;
  readonly completeness: "complete" | "partial" | "unknown" | "missing";
  /** Credential-shaped text was masked or an overlong historical value was shortened. */
  readonly isFiltered: boolean;
}

/** One authorized run attempt; it contains no environment values or provider credentials. */
export interface AgentPlanDiagnostic {
  readonly planId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly loopId: string | null;
  readonly iteration: number | null;
  readonly planRevision: number;
  readonly appliedPlanRevision: number;
  readonly attemptId: string | null;
  /** Recorded automatic retries; missing legacy IDs and absent detailed exit data are not reconstructed. */
  readonly retryAttempts: readonly Pick<
    AgentPlanRetryAttempt,
    "attemptId" | "endedAt" | "code"
  >[];
  readonly name: string;
  readonly status:
    "waiting" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
  readonly error: string | null;
  readonly blockedByStepId: string | null;
  readonly target: AgentPlanStepExecution["target"] | null;
  readonly workspace: AgentPlanStepExecution["workspace"] | null;
  /** The recorded directory, even in older attempts without workspace metadata. */
  readonly directory: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  /** Remote times are observations from Pages, not proven process timestamps. */
  readonly timingBasis:
    "process" | "session" | "remote_observation" | "unknown";
  readonly runner: string | null;
  readonly model: string | null;
  readonly interpreterProfileId: string | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly failure: string | null;
  readonly closeout: string | null;
  readonly verdict: "accepted" | "open" | "rejected" | null;
  readonly result: AgentPlanDiagnosticStream;
  readonly stdout: AgentPlanDiagnosticStream;
  readonly stderr: AgentPlanDiagnosticStream;
  /** A safe next step; a failed or unknown closeout never implies release. */
  readonly nextAction: string | null;
}
