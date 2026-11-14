import { allPlanSteps } from "@/definition/AgentPlanGroup";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { planConnectionIssues } from "@/definition/AgentPlanGraph";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentPlanInput, AgentPlanStep } from "@/definition/AgentPlan";

export { hasPlanPath } from "@/definition/AgentPlanGraph";
export { arePlanNodesOrdered } from "@/definition/AgentPlanBranchingGraph";

/** Finds agent execution nodes without confusing data and flow control nodes with agents. */
export function planSteps(plan: AgentPlanInput): readonly AgentPlanStep[] {
  return allPlanSteps(plan);
}

/** Rejects ambiguous node identities on save; incomplete connections and values remain editable warnings. */
export function validatePlanGraph(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): void {
  const issues = planConnectionIssues(plan, agents).filter(
    (issue) => issue.reason === "duplicateNode",
  );
  if (issues.length > 0) throw new AgentPlanValidationError(issues);
}
