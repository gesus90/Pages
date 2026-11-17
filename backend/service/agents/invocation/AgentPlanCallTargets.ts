import { planStartIssues } from "@/definition/AgentPlanStart";
import {
  planCallableEntries,
  planEntryContract,
} from "@/definition/AgentPlanJump";
import { canRunPlan } from "@/definition/AgentPlanTeam";

import type {
  AgentPlanCallEntry,
  AgentPlanCallTarget,
} from "@/definition/AgentPlanJump";
import type { AgentPlanAccess } from "../AgentPlanAccess";

/**
 * The plans a person may call from a Jump, with their entries that are released for calls.
 * @param access - Reads the plans the person may read.
 * @param userId - The person who edits.
 * @remarks
 * Only plans the person may read and run appear, with entries that exist,
 * are released and lead to an end. The list is a convenience of the editor: the
 * server checks every call again, with the rights of whoever runs it.
 */
export async function readCallTargets(
  access: Pick<AgentPlanAccess, "list">,
  userId: string,
): Promise<readonly AgentPlanCallTarget[]> {
  const plans = await access.list(userId);
  return plans.filter(canRunPlan).flatMap((plan): AgentPlanCallTarget[] => {
    const entries = planCallableEntries(plan).flatMap(
      (entry): AgentPlanCallEntry[] => {
        const contract = planEntryContract(plan, entry.id);
        if (!contract || planStartIssues(plan, entry.id).length > 0) return [];
        return [
          {
            entryNodeId: entry.id,
            entryName: contract.entryName,
            kind: contract.direction,
            inputs: contract.inputs,
            returns: contract.returns,
            hasReturnConflict: contract.hasReturnConflict,
          },
        ];
      },
    );
    return entries.length === 0
      ? []
      : [
          {
            planId: plan.id,
            planName: plan.name,
            revision: plan.revision,
            entries,
          },
        ];
  });
}
