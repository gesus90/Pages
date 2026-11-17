import { AgentError } from "@/backend/error/AgentErrors";
import { canReleasePlanWorkspaceLocks } from "@/definition/AgentPlanWorkspaceLock";

import type { PlanDependencies } from "./AgentPlanDependencies";
import type { DatabaseTransaction } from "@/backend/database/Database";

/** Optional target binding and audit committed in the reservation release transaction. */
export interface PlanWorkspaceLockReleaseOptions {
  readonly planId?: string;
  readonly journal?: (transaction: DatabaseTransaction) => Promise<void>;
}

/** Releases an ended run's locks after checking the caller's access. */
export async function releasePlanWorkspaceLocks(
  dependencies: {
    readonly runs: Pick<PlanDependencies["runs"], "find">;
    readonly access: Pick<PlanDependencies["access"], "require">;
    readonly workspaceLocks?: Pick<
      NonNullable<PlanDependencies["workspaceLocks"]>,
      "release"
    >;
  },
  userId: string,
  runId: string,
  options: PlanWorkspaceLockReleaseOptions = {},
): Promise<void> {
  const run = await dependencies.runs.find(runId);
  if (!run) throw new AgentError("plan_run_unavailable");
  const plan = await dependencies.access.require(userId, run.planId);
  if (options.planId !== undefined && options.planId !== run.planId)
    throw new AgentError("plan_run_unavailable");
  if (!canReleasePlanWorkspaceLocks(plan, userId))
    throw new AgentError("plan_access_denied");
  if (!dependencies.workspaceLocks)
    throw new AgentError("plan_run_unavailable");
  await dependencies.workspaceLocks.release(
    run,
    "user_requested",
    options.journal,
  );
}
