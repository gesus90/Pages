import { isPlanHistoryReadFailure } from "./AgentPlanControlAccess";

import type { AgentPlanRecoveryEntry } from "@/definition/AgentPlanOperations";
import type { AgentPlanRecoveryView } from "@/definition/AgentPlanRecovery";
import type { AgentPlanService } from "./AgentPlanService";

/** Rechecks the linked run's current access without disclosing an inaccessible ID. */
export async function canReadPlanContinuation(
  plans: Pick<AgentPlanService, "run">,
  userId: string,
  recovery: AgentPlanRecoveryView,
): Promise<boolean> {
  if (!recovery.continuedBy) return false;
  try {
    const continuation = await plans.run(userId, recovery.continuedBy);
    return continuation.planId === recovery.planId;
  } catch (error) {
    if (isPlanHistoryReadFailure(error)) return false;
    throw error;
  }
}

function continuationStatus(
  recovery: AgentPlanRecoveryView,
  canRead: boolean,
): AgentPlanRecoveryEntry["continuationStatus"] {
  if (!recovery.continuedBy) return "none";
  return canRead ? "available" : "unavailable";
}

/** Projects the authorized recovery view without prompts or native session identifiers. */
export function planRecoveryEntry(
  recovery: AgentPlanRecoveryView,
  canReadContinuation: boolean,
): AgentPlanRecoveryEntry {
  return {
    planId: recovery.planId,
    runId: recovery.runId,
    revision: recovery.revision,
    planRevision: recovery.planRevision,
    currentPlanRevision: recovery.currentPlanRevision,
    state: recovery.state,
    continuedBy: canReadContinuation ? recovery.continuedBy : null,
    continuationStatus: continuationStatus(recovery, canReadContinuation),
    isCleanupUnconfirmed: recovery.isCleanupUnconfirmed,
    latestCleanupFailure: recovery.latestCleanupFailure ?? null,
    cleanupResources: recovery.cleanupResources.map((resource) => ({
      ...resource,
      stepName: recovery.stepNames[resource.stepId] ?? resource.stepId,
    })),
    restart: recovery.restart,
    resume: {
      available: recovery.resume.available,
      reason: recovery.resume.reason,
      modes: recovery.resume.modes,
      reusedStepIds: recovery.resume.reusedStepIds,
      reviewStepIds: recovery.resume.reviewStepIds,
    },
    release: recovery.release,
    blockers: recovery.blockers,
    commandSurface: "editor_and_mcp",
  };
}
