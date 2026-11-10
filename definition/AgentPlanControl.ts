import type { AgentPlanWriterWait } from "./AgentPlanExecution";
import type { AgentWorkspaceCleanup } from "./AgentWorkspaceCleanup";
import type { AgentPlanIssue } from "./AgentPlanGraph";
import type { AgentPlanRun } from "./AgentPlan";
import type { AgentPlanWorkspaceConflict } from "./AgentPlanWorkspaceConflict";
import type { AgentPlanStartRejection } from "./AgentPlanStartRejection";

/** The reasons {@link AgentPlanControl.resumeBlocker} names. */
export const AGENT_PLAN_RESUME_BLOCKERS = [
  "own_run_required",
  "plan_access_denied",
] as const;

export type AgentPlanResumeBlocker =
  (typeof AGENT_PLAN_RESUME_BLOCKERS)[number];

/** Plan-visible control metadata contains no private prompts, results or session details. */
export interface AgentPlanControl {
  readonly runId: string | null;
  readonly status: AgentPlanRun["status"] | "idle";
  readonly canPlay: boolean;
  readonly canRestart?: boolean;
  readonly resumeAction?: "paused" | "recovery";
  /**
   * Why the reader cannot continue the newest paused or ended run.
   *
   * @remarks
   * Set apart from the history the reader may see, so an empty or refused
   * history never reads as a plan that has not run. `own_run_required` names
   * a run of another executor, whose identity stays hidden;
   * `plan_access_denied` an own run whose current content or resource rights
   * are missing. Absent while continuing is not the question or allowed.
   */
  readonly resumeBlocker?: AgentPlanResumeBlocker;
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
