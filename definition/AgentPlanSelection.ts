import { allPlanSteps } from "./AgentPlanGroup";

import type { AgentPlanInput, AgentPlanStep } from "./AgentPlan";

/** The explicit choice left open after a clone repaired an unavailable reference. */
export function planStepSelection(
  step: AgentPlanStep,
): "agent" | "model" | null {
  if (step.configuration?.model) return null;
  if (step.selectionRequired) return step.selectionRequired;
  return step.agentId === "" ? "agent" : null;
}

/** Every unselected agent or model, including members of groups and loops. */
export function planPendingSelections(
  plan: AgentPlanInput,
): readonly AgentPlanStep[] {
  return allPlanSteps(plan).filter((step) => planStepSelection(step) !== null);
}
