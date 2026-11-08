import type { AgentPlanWriterWait } from "./AgentPlanExecution";
import type { AgentWorkspaceCleanup } from "./AgentWorkspaceCleanup";
import type { AgentPlanIssue } from "./AgentPlanGraph";
import type { AgentPlanRun } from "./AgentPlan";
import type { AgentPlanWorkspaceConflict } from "./AgentPlanWorkspaceConflict";
import type { AgentPlanStartRejection } from "./AgentPlanStartRejection";

/** Plan-visible control metadata contains no private prompts, results or session details. */
export interface AgentPlanControl {
  readonly runId: string | null;
  readonly status: AgentPlanRun["status"] | "idle";
  readonly canPlay: boolean;
  readonly canRestart?: boolean;
  readonly resumeAction?: "paused" | "recovery";
  readonly workspaceWait?: AgentPlanWriterWait;
  readonly cleanup?: readonly AgentWorkspaceCleanup[];
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canStop: boolean;
  /**
   * Whether the reader holds the right to change the plan.
   *
   * @remarks
   * While a run executes steps the server refuses every change anyway; the
   * editor reads that from {@link AgentPlanControl.status}.
   */
  readonly canEdit: boolean;
  readonly issue: string | null;
  readonly issues?: readonly AgentPlanIssue[];
  /** The editor's own nodes and resolved targets in a workspace refusal. */
  readonly workspaceConflict?: AgentPlanWorkspaceConflict;
  /** The requester's last recorded refusal, separate from the current availability. */
  readonly lastStartRejection?: AgentPlanStartRejection;
  readonly planRevision: number | null;
  readonly continuationVersion: number;
  readonly frontierStepIds: readonly string[];
}
