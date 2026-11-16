import { AgentError } from "@/backend/error/AgentErrors";
import { canReleasePlanWorkspaceLocks } from "@/definition/AgentPlanWorkspaceLock";

import type { PlanDependencies } from "./AgentPlanDependencies";

/** Releases an ended run's locks after checking the caller's access. */
export async function releasePlanWorkspaceLocks(
  dependencies: PlanDependencies,
  userId: string,
  runId: string,
): Promise<void> {
  const run = await dependencies.runs.find(runId);
  if (!run) throw new AgentError("plan_run_unavailable");
  const plan = await dependencies.access.require(userId, run.planId);
  if (!canReleasePlanWorkspaceLocks(plan, userId))
    throw new AgentError("plan_access_denied");
  if (!dependencies.workspaceLocks)
    throw new AgentError("plan_run_unavailable");
  await dependencies.workspaceLocks.release(run);
}
