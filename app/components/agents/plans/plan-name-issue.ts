import { agentPlanNameKey } from "@/definition/AgentPlanName";

import type { AgentPlanInput, AgentPlanPage } from "@/definition/AgentPlan";
import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";

/**
 * Whether a plan the person can see already has the draft's name in the same team area.
 *
 * @remarks
 * An early warning from the plans the page lists, using the same key as the
 * server and the database. Only the server decides: a plan the list does
 * not know yet is found when the plan is saved.
 *
 * @param page - The plan page.
 * @param draft - The plan in the editor.
 * @param savedId - The plan a save created from this draft, which the list
 * already shows while the editor still holds the draft of a new plan.
 */
export function isPlanNameListed(
  page: AgentPlanPage,
  draft: AgentPlanInput,
  savedId: string | undefined,
): boolean {
  const key = agentPlanNameKey(draft.name);
  const departmentId = page.selected
    ? (page.selected.departmentId ?? null)
    : (page.teamDepartmentId ?? null);
  if (key === "" || departmentId === null) return false;
  const projectId = page.workspaces.find(
    (workspace) => workspace.id === draft.workspaceId,
  )?.projectId;
  return page.plans.some(
    (plan) =>
      plan.id !== (page.selected?.id ?? savedId) &&
      plan.departmentId === departmentId &&
      plan.projectId === projectId &&
      agentPlanNameKey(plan.name) === key,
  );
}

/**
 * Whether the last save was refused because the name it carried is taken.
 *
 * @param result - The answer to the last request of the editor.
 * @param submittedName - The name that request carried.
 * @param name - The name in the draft now; editing it clears the refusal.
 */
export function isPlanNameRefused(
  result: AgentPlanActionResult | undefined,
  submittedName: string | null,
  name: string,
): boolean {
  return (
    result?.ok === false &&
    result.error === "plan_name_taken" &&
    submittedName === name
  );
}
