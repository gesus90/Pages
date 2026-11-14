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

/** Rejects ambiguous identities and bindings to unknown inputs on save. */
export function validatePlanGraph(
  plan: AgentPlanInput,
  agents: readonly AgentDefinitionChoice[],
): void {
  const issues = planConnectionIssues(plan, agents).filter(
    (issue) =>
      issue.reason === "duplicateNode" ||
      (issue.reason === "port" &&
        planSteps(plan).some(
          (step) =>
            step.id === issue.nodeId &&
            issue.port !== null &&
            Object.hasOwn(step.bindings, issue.port),
        )),
  );
  if (issues.length > 0) throw new AgentPlanValidationError(issues);
}
