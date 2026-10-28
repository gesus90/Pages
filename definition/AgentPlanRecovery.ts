import type { AgentPlanAcceptance } from "./AgentPlanSession";
import type { AgentPlanRun } from "./AgentPlan";
import type { AgentPlanScriptRun } from "./AgentPlanScript";
import type { AgentPlanScriptAssessment } from "./AgentPlanScriptReport";
import type {
  AgentPlanCleanupResource,
  AgentPlanCleanupFailureRecord,
} from "./AgentPlanCleanupResource";

/** Additive reasons keep older run statuses readable without reopening old failures. */
export interface AgentPlanRecoveryReason {
  readonly state: "recoverable" | "interrupted";
  readonly requiresReconciliation: boolean;
}

export type AgentPlanFailureClass =
  | "provider"
  | "approval"
  | "business"
  | "configuration"
  | "timeout"
  | "interruption"
  | "cleanup"
  | "cancelled"
  | "terminal";

/** Capabilities announced by a verified adapter, independently of a Pages recovery path. */
export interface AgentPlanContinuationCapabilities {
  readonly canResume: boolean;
  readonly canLoad: boolean;
  readonly adapter: string;
}

export type AgentPlanRecoveryMode = "live" | "native_resume" | "new_session";

/**
 * How a run came from an earlier run of the same plan.
 *
 * @remarks
 * A restart begins at the start of the plan. A resume takes over the verified
 * successful results of the earlier run unchanged and executes only its open,
 * failed or interrupted work again, each as a new attempt. The earlier run,
 * its failures, checkpoints and journal stay as they were.
 */
export interface AgentPlanRunOrigin {
  readonly kind: "restart" | "resume";
  readonly runId: string;
  /** The session decision of a resume; `null` for a restart. */
  readonly mode: Exclude<AgentPlanRecoveryMode, "live"> | null;
  /** The newest verified completion of the earlier run, `null` without one. */
  readonly checkpointVersion: number | null;
  /** Results taken over unchanged; each matches the digest of its checkpoint. */
  readonly reusedStepIds: readonly string[];
  /** Nodes that had started and run again as a new attempt. */
  readonly retriedStepIds: readonly string[];
  /** Nodes whose possible side effects the executor reviewed before the new attempt. */
  readonly reviewedStepIds: readonly string[];
  readonly requestedAt: string;
}

/** One immutable completion; references and digests never contain resolved prompt content. */
export interface AgentPlanCheckpointInput {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly stepId: string;
  readonly completedAt: string;
  readonly snapshotDigest: string;
  /** Pages completion metadata does not establish a workflow restoration checkpoint. */
  readonly workflow: { readonly engine: "pages"; readonly runId: null };
  readonly completedStepIds: readonly string[];
  readonly pendingStepIds: readonly string[];
  readonly dependencies: readonly {
    readonly stepId: string;
    readonly status: string;
  }[];
  readonly inputs: readonly {
    readonly name: string;
    readonly kind: "literal" | "source" | "result" | "previous";
    readonly reference: string | null;
    readonly digest: string;
  }[];
  readonly configurationDigest: string;
  readonly workspaceDigest: string;
  readonly context: {
    readonly groupId: string | null;
    readonly agentId: string | null;
    readonly agentRevision: number | null;
    readonly connectionId: string | null;
    readonly provider: string | null;
    readonly model: string | null;
    readonly workspaceIds: readonly string[];
  };
  readonly dispatchedPromptDigest: string | null;
  readonly result: {
    /** Process evidence; stdout is null here because the declared data is stored once in output. */
    readonly script?: AgentPlanScriptRun;
    readonly report?: AgentPlanScriptAssessment;
    readonly output: string | null;
    /** Inline assets and credential-shaped text may be omitted from this display copy. */
    readonly isOutputReduced: boolean;
    readonly outputDigest: string;
    readonly technical: {
      readonly resultCode: 0 | -1 | null;
      readonly closeout: string | null;
    };
    readonly acceptance: AgentPlanAcceptance | null;
  };
  readonly session: {
    readonly attemptId: string | null;
    readonly instanceId: string;
    readonly sessionId: string | null;
    readonly capabilities: AgentPlanContinuationCapabilities | null;
  } | null;
}

/** Version and run revision are allocated by the completion transaction. */
export interface AgentPlanCheckpoint extends AgentPlanCheckpointInput {
  readonly version: number;
  readonly runRevision: number;
  /** Present on a display copy when credential-shaped text was filtered. */
  readonly isDisplayFiltered?: boolean;
}

interface RecoveryCommandIdentity {
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}

/** Recording a repair never sends its instruction to an agent. */
export type AgentPlanRecoveryCommand = RecoveryCommandIdentity &
  (
    | {
        readonly action: "record_repair";
        readonly stepId: string;
        readonly instruction: string;
      }
    | {
        readonly action: "reconcile";
        readonly stepId: string;
        readonly decision: "effects_reviewed";
        readonly note: string;
      }
    | { readonly action: "cancel" }
    | {
        readonly action: "resume";
        readonly mode: AgentPlanRecoveryMode;
        /** The saved plan revision deliberately selected for the continuation. */
        readonly revision?: number;
        /** Started nodes whose possible side effects the executor reviewed; each runs again. */
        readonly reviewedStepIds: readonly string[];
      }
    | {
        readonly action: "restart";
        /** The saved plan revision the new run starts with, as the executor saw it. */
        readonly revision: number;
        /** The executor knows that every node runs again, including earlier side effects. */
        readonly confirmRepeat: true;
      }
    | { readonly action: "release" }
  );

/** An append-only preparation or decision, with no implied native execution. */
export interface AgentPlanRepairAttempt {
  readonly id: string;
  readonly runId: string;
  readonly userId: string;
  readonly stepId: string | null;
  readonly action: "record_repair" | "reconcile" | "cancel";
  readonly text: string | null;
  readonly status: "recorded" | "cancelled";
  readonly revision: number;
  readonly createdAt: string;
}

export interface AgentPlanRecoveryResult {
  readonly commandId: string;
  readonly revision: number;
  readonly outcome: "recorded" | "cancelled" | "started" | "released";
  /** The run a restart or resume started. */
  readonly runId?: string;
}

/** A decision of the executor that started or released something, journaled with its run. */
export interface AgentPlanRecoveryExecution {
  readonly id: string;
  readonly runId: string;
  readonly userId: string;
  readonly action: "restart" | "resume" | "release";
  /** The run it started; `null` for a release. */
  readonly targetRunId: string | null;
  readonly origin: AgentPlanRunOrigin | null;
  readonly revision: number;
  readonly createdAt: string;
}

/** Whether one recovery action can run now, and the concrete reason when it cannot. */
export interface AgentPlanRecoveryOption {
  readonly available: boolean;
  readonly reason: AgentPlanRecoveryBlocker | null;
}

/** Why an action is not available now; each names what the executor can do about it. */
export type AgentPlanRecoveryBlocker =
  | "run_active"
  | "plan_run_active"
  | "plan_read_only"
  | "cancelled_by_user"
  | "succeeded"
  | "superseded"
  | "already_continued"
  | "cleanup_unconfirmed"
  | "plan_completed_changed"
  | "plan_context_changed"
  | "plan_definition_changed"
  | "checkpoint_mismatch"
  | "nothing_to_release"
  | "workflow_unavailable"
  | "context_not_verified";

export type AgentPlanRecoveryErrorCode =
  | "invalid_request"
  | "access_denied"
  | "revision_conflict"
  | "idempotency_conflict"
  | "action_unavailable"
  | "workflow_unavailable"
  | "checkpoint_invalid"
  | "checkpoint_too_large"
  | "review_required"
  | "cleanup_unconfirmed"
  | "native_resume_unavailable"
  | "diagnostic_unavailable";

/** The state of a run after a disturbance and what its executor can do now. */
export interface AgentPlanRecoveryView {
  readonly runId: string;
  readonly planId: string;
  /** The names of the run's nodes, so every decision names what it concerns. */
  readonly stepNames: Readonly<Record<string, string>>;
  readonly revision: number;
  /** The plan revision the run executed; a continuation names the adopted one. */
  readonly planRevision: number;
  /** The plan's saved revision now, which a restart starts with. */
  readonly currentPlanRevision: number;
  readonly origin: AgentPlanRunOrigin | null;
  /** The run a restart or resume of this run started. */
  readonly continuedBy: string | null;
  /** Whether processes or working copies of the run are still held because their end is unproven. */
  readonly isCleanupUnconfirmed: boolean;
  /** Recorded sources of unconfirmed cleanup while this run still holds reservations. */
  readonly cleanupResources: readonly AgentPlanCleanupResource[];
  /** Last stored failure is historical and survives later successful cleanup. */
  readonly latestCleanupFailure?: AgentPlanCleanupFailureRecord | null;
  readonly restart: AgentPlanRecoveryOption;
  readonly resume: AgentPlanRecoveryOption & {
    readonly modes: readonly {
      readonly mode: Exclude<AgentPlanRecoveryMode, "live">;
      readonly available: boolean;
    }[];
    /** Results a resume takes over unchanged. */
    readonly reusedStepIds: readonly string[];
    /** Started nodes a resume runs again; each needs a reviewed side-effect decision. */
    readonly reviewStepIds: readonly string[];
  };
  readonly release: AgentPlanRecoveryOption;
  readonly executions: readonly AgentPlanRecoveryExecution[];
  readonly state:
    | "running"
    | "pausing"
    | "stopping"
    | "paused"
    | "recoverable"
    | "interrupted"
    | "failed_terminal"
    | "cancelled"
    | "succeeded";
  readonly checkpoint: AgentPlanCheckpoint | null;
  readonly attempts: readonly AgentPlanRepairAttempt[];
  readonly nodes: readonly {
    readonly stepId: string;
    readonly error: string | null;
    readonly failureClass: AgentPlanFailureClass;
    readonly canRecordRepair: boolean;
    readonly sideEffects: "unknown" | "reviewed";
    readonly capabilities: AgentPlanContinuationCapabilities | null;
    readonly modes: readonly {
      readonly mode: AgentPlanRecoveryMode;
      readonly available: boolean;
      readonly reason:
        | "workflow_unavailable"
        | "session_not_available"
        | "capabilities_unknown"
        | "native_capability_unavailable"
        | "session_unknown"
        | "loop_session"
        | null;
    }[];
  }[];
  readonly allowedActions: readonly AgentPlanRecoveryCommand["action"][];
  /** Every reason that blocks an action now; empty when all are possible. */
  readonly blockers: readonly AgentPlanRecoveryBlocker[];
}

/** Shared state contract: historical terminal failures and explicit stops never acquire repair actions. */
export function canRecordPlanRepair(run: AgentPlanRun): boolean {
  return (
    run.status === "failed" && !run.stopRequested && run.recovery !== undefined
  );
}
