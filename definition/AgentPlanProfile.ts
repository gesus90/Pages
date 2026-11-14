import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentPlanStep } from "./AgentPlan";

/** Why a profile-bound node cannot run; direct model routes need no profile. */
export function planProfileProblem(
  step: AgentPlanStep,
  agents: readonly AgentDefinitionChoice[],
): "profileMissing" | "profileInactive" | null {
  if (step.configuration?.connectionId || step.configuration?.runnerRoute)
    return null;
  const profile = agents.find((agent) => agent.id === step.agentId);
  if (!profile) return "profileMissing";
  return profile.availability.reason === "agent_inactive"
    ? "profileInactive"
    : null;
}
