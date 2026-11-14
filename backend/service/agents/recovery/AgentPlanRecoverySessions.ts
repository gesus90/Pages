import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";
import type { ResumePlan } from "./AgentPlanRecoveryPlanning";

/** Keeps native identities only for sessions compatible with the newly saved execution route. */
export function compatibleRecoverySessions(
  plan: ResumePlan,
  previous: AgentPlanSnapshot,
  proposed: AgentPlanSnapshot,
): ResumePlan {
  const resumeSessions: Record<string, string> = {};
  for (const step of proposed.steps) {
    const old = previous.steps.find((entry) => entry.step.id === step.step.id);
    if (
      !old ||
      old.provider !== step.provider ||
      old.connectionId !== step.connectionId ||
      old.groupId !== step.groupId ||
      old.loopId !== step.loopId
    )
      continue;
    const sessionId =
      plan.resumeSessions[step.step.id] ??
      plan.resumeSessions[step.groupId ?? step.step.id];
    if (!sessionId) continue;
    resumeSessions[step.step.id] = sessionId;
    if (step.groupId) resumeSessions[step.groupId] = sessionId;
  }
  return {
    ...plan,
    resumeSessions,
    canResumeNatively: Object.keys(resumeSessions).length > 0,
  };
}
