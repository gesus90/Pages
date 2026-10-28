import { AgentError } from "@/backend/error/AgentErrors";
import { RemoteError } from "@/backend/error/RemoteErrors";

import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";
import type { AgentPlanWorkspaces } from "./AgentPlanWorkspaces";

/** Rechecks historical target rights without disclosing foreign reservation ownership. */
export async function visibleStartRejection(
  workspaces: Pick<AgentPlanWorkspaces, "requireAccess"> | undefined,
  userId: string,
  plan: AgentPlan,
  rejection: AgentPlanStartRejection | null,
): Promise<AgentPlanStartRejection | null> {
  if (!rejection?.conflict) return rejection;
  if (workspaces) {
    try {
      for (const target of rejection.conflict.targets)
        await workspaces.requireAccess(
          userId,
          target.workspaceId,
          plan.projectId,
        );
      return rejection;
    } catch (error: unknown) {
      if (!(error instanceof AgentError) && !(error instanceof RemoteError))
        throw error;
    }
  }
  return { ...rejection, conflict: null, targetResolution: "unknown" };
}
