import { requireCloneablePlan } from "@/backend/agents/AgentPlanCloneShape";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { readPlanInput } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { requireCredentialFreeText } from "@/backend/security/AgentTextSafety";
import { withoutTicketFlow } from "@/definition/AgentPlanGraph";
import { withPortlessPlanGroups } from "@/definition/AgentPlanGroupUpgrade";
import { removePlanNode } from "@/definition/AgentPlanRemoval";

import type { AgentPlanInput } from "@/definition/AgentPlan";

/** Reads the same bounded fields as a save and removes obsolete flow and closeout structure. */
export function cleanCloneForm(source: unknown): {
  readonly plan: AgentPlanInput;
  readonly wasCleaned: boolean;
} {
  requireCredentialFreeText(JSON.stringify(source));
  let parsed: AgentPlanInput;
  try {
    parsed = readPlanInput(source);
  } catch (error: unknown) {
    if (error instanceof AgentError)
      throw new AgentError("plan_schema_unsupported");
    throw error;
  }
  let plan = withPortlessPlanGroups(withoutTicketFlow(parsed));
  for (const node of plan.nodes)
    if (node.type === "git_closeout") plan = removePlanNode(plan, node.id);
  let discardedFields = false;
  try {
    requireCloneablePlan(source);
  } catch (error: unknown) {
    if (!(error instanceof AgentOperationError)) throw error;
    discardedFields = true;
  }
  const wasCleaned =
    discardedFields ||
    plan.nodes.length !== parsed.nodes.length ||
    JSON.stringify(plan.edges) !== JSON.stringify(parsed.edges);
  return { plan, wasCleaned };
}
