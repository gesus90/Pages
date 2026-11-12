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

/** The state of a run that "Fortsetzen" continues, which decides the way it takes. */
export const AGENT_PLAN_RESUME_KINDS = [
  "paused",
  "failed",
  "interrupted",
  "blocked",
  "closeout_open",
  "stopped",
] as const;

export type AgentPlanResumeKind = (typeof AGENT_PLAN_RESUME_KINDS)[number];

/**
 * What a person can do to lift a block of "Fortsetzen" right away.
 *
 * @remarks
 * `admin_mode` switches to the active admin mode, `release` frees the working
 * copies and leases of the run after its processes ended, `restart` begins a
 * new run from the start, `wait` names a state that settles by itself, and
 * `none` a block that only a change outside the run lifts, such as a
 * login or a changed plan.
 */
export const AGENT_PLAN_RESUME_ACTIONS = [
  "admin_mode",
  "release",
  "restart",
  "wait",
  "none",
] as const;

export type AgentPlanResumeAction = (typeof AGENT_PLAN_RESUME_ACTIONS)[number];

/** Why "Fortsetzen" is off, and the next step; never present without a reason. */
export interface AgentPlanResumeBlock {
  /** An error or recovery code; the interface translates it. */
  readonly code: string;
  readonly action: AgentPlanResumeAction;
  /** The run that holds the workspace, when another run is the reason. */
  readonly holderRunId?: string;
}

/** Plan-visible control metadata contains no private prompts, results or session details. */
export interface AgentPlanControl {
  readonly runId: string | null;
  readonly status: AgentPlanRun["status"] | "idle";
  readonly canPlay: boolean;
  readonly canRestart?: boolean;
  readonly resumeAction?: "paused" | "recovery";
  /** Which state "Fortsetzen" continues; absent while there is nothing to continue. */
  readonly resumeKind?: AgentPlanResumeKind;
  /**
   * Why a continuable run cannot be continued now, with the action that lifts it.
   *
   * @remarks
   * Present exactly while `resumeKind` is set and `canResume` is false, so the
   * interface and the Pages tools name the same reason.
   */
  readonly resumeBlock?: AgentPlanResumeBlock;
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
