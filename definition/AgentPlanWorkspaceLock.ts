import { isPlanAdministrator } from "./AgentPlanTeam";

import type { AgentPlanRun, AgentPlanView } from "./AgentPlan";

/** Public ownership facts of a workspace reservation, without historical run content. */
export interface AgentPlanWorkspaceLock {
  readonly runId: string;
  /** The plan of the holding run, disclosed only after the reader may see that plan. */
  readonly planId: string;
  readonly status: AgentPlanRun["status"];
  readonly acquiredAt: string;
  readonly ageMilliseconds: number;
  readonly reason: "active" | "resumable" | "cleanup";
  readonly isOverdue: boolean;
  readonly canRelease: boolean;
}

/** A personal-client decision bound to one ended run and one stable operation identifier. */
export interface AgentPlanWorkspaceLockReleaseRequest {
  readonly operation: "plans.workspace_locks.release";
  readonly operationId: string;
  readonly planId: string;
  readonly runId: string;
}

/** Retained continuations warn after one day; expiry never silently discards their work. */
export const PLAN_LOCK_WARNING_AGE_MS = 24 * 60 * 60_000;

/** Only the holder plan's owner or an active administrator can discard its reservation. */
export function canReleasePlanWorkspaceLocks(
  plan: Pick<AgentPlanView, "ownerId" | "rights">,
  userId: string,
): boolean {
  return plan.ownerId === userId || isPlanAdministrator(plan);
}
