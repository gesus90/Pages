import type { AgentPlanAcceptance } from "./AgentPlanSession";
import type { AgentPlanRun } from "./AgentPlan";
import type { AgentPlanScriptRun } from "./AgentPlanScript";

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

/** One immutable completion; references and digests never contain resolved prompt content. */
export interface AgentPlanCheckpointInput {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly stepId: string;
  readonly completedAt: string;
  readonly snapshotDigest: string;
  /** No Mastra mapping exists yet; this is a Pages completion, not a Mastra checkpoint. */
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
      }
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
  readonly outcome: "recorded" | "cancelled";
}

export type AgentPlanRecoveryErrorCode =
  | "invalid_request"
  | "access_denied"
  | "revision_conflict"
  | "idempotency_conflict"
  | "action_unavailable"
  | "workflow_unavailable"
  | "checkpoint_invalid"
  | "checkpoint_too_large";

/** Authorized diagnostic contract for a future PageAgentCLI recovery client. */
export interface AgentPlanRecoveryView {
  readonly runId: string;
  readonly revision: number;
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
      readonly available: false;
      readonly reason:
        | "workflow_unavailable"
        | "session_not_available"
        | "capabilities_unknown"
        | "native_capability_unavailable";
    }[];
  }[];
  readonly allowedActions: readonly AgentPlanRecoveryCommand["action"][];
  readonly blockers: readonly ["workflow_unavailable", "context_not_verified"];
}

/** Shared state contract: historical terminal failures and explicit stops never acquire repair actions. */
export function canRecordPlanRepair(run: AgentPlanRun): boolean {
  return (
    run.status === "failed" && !run.stopRequested && run.recovery !== undefined
  );
}
