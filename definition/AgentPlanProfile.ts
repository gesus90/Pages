import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentPlanStep } from "./AgentPlan";
import type { AgentPlanIssue } from "./AgentPlanGraph";

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

/** Keeps a profile problem alongside any independently detected input problems. */
export function planAvailabilityIssues(
  step: AgentPlanStep,
  agent: AgentDefinitionChoice | undefined,
  nodeIssue: AgentPlanIssue | null,
): AgentPlanIssue[] {
  const problem = planProfileProblem(step, agent ? [agent] : []);
  if (problem) return [{ nodeId: step.id, port: null, reason: problem }];
  return nodeIssue ? [nodeIssue] : [];
}
