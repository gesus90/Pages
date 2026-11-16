import { canReleasePlanWorkspaceLocks } from "@/definition/AgentPlanWorkspaceLock";
import { AgentError } from "@/backend/error/AgentErrors";
import { canRunPlan } from "@/definition/AgentPlanTeam";

import type { AgentPlanWorkspaceLocks } from "./AgentPlanWorkspaceLocks";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";

interface CleanupDecisionDependencies {
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly runs: Pick<AgentPlanRunRepository, "find">;
  readonly workspaceLocks?: Pick<AgentPlanWorkspaceLocks, "release">;
  readonly workspaceCleanup?: AgentWorkspaceCleanupRepository;
}

/** Authorizes an explicit retry or a person's attestation independently of historical result access. */
export async function decideWorkspaceCleanup(
  dependencies: CleanupDecisionDependencies,
  userId: string,
  input: {
    readonly planId: string;
    readonly runId: string;
    readonly workspaceId: string;
    readonly action: "retry" | "release";
  },
): Promise<void> {
  const plan = await dependencies.access.require(userId, input.planId);
  if (!canRunPlan(plan)) throw new AgentError("plan_access_denied");
  const repository = dependencies.workspaceCleanup;
  const entry = (await repository?.forPlan(userId, plan.id))?.find(
    (candidate) =>
      candidate.runId === input.runId &&
      candidate.workspaceId === input.workspaceId &&
      candidate.ownerId === userId,
  );
  if (!repository || !entry) throw new AgentError("plan_run_unavailable");
  if (input.action === "release") {
    if (!canReleasePlanWorkspaceLocks(plan, userId))
      throw new AgentError("plan_access_denied");
    const run = await dependencies.runs.find(entry.runId);
    if (!run || !dependencies.workspaceLocks || run.planId !== plan.id)
      throw new AgentError("plan_run_unavailable");
    await dependencies.workspaceLocks.release(run);
  }
  await repository.decide(entry, input.action);
}
