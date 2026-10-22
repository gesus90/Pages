import type { AgentPlanIssue } from "./AgentPlanGraph";
import type { AgentPlanRun } from "./AgentPlan";

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
  readonly planRevision: number | null;
  readonly continuationVersion: number;
  readonly frontierStepIds: readonly string[];
}
