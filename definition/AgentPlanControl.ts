import type { AgentPlanIssue } from "./AgentPlanGraph";
import type { AgentPlanRun } from "./AgentPlan";
import type { AgentPlanWorkspaceConflict } from "./AgentPlanWorkspaceConflict";
import type { AgentPlanStartRejection } from "./AgentPlanStartRejection";

/** Plan-visible control metadata contains no private prompts, results or session details. */
export interface AgentPlanControl {
  readonly runId: string | null;
  readonly status: AgentPlanRun["status"] | "idle";
  readonly canPlay: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canStop: boolean;
  /** Saving a new revision is independent of the active run, whose snapshot stays pinned. */
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
