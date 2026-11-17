import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import {
  isPlanJumpOut,
  planCalledPlanIds,
  wouldCloseCallCycle,
} from "@/definition/AgentPlanJump";

import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlan } from "@/definition/AgentPlan";

/**
 * Refuses a plan whose calls would close a circle of plans.
 * @param plans - Every stored plan, from which the calls of the others are read.
 * @param plan - The plan about to be saved.
 * @throws {AgentPlanValidationError} With the Jump nodes that call a plan which, directly or through
 * other plans, calls this one again (`plan_jump_cycle`).
 * @remarks
 * The check is on the saved plans; at run time the actual chain of calls is
 * checked again, which also covers plans changed since.
 */
export async function requireNoPlanCallCycle(
  plans: Pick<AgentPlanRepository, "list">,
  plan: AgentPlan,
): Promise<void> {
  if (planCalledPlanIds(plan).length === 0) return;
  const calls = (await plans.list())
    .filter((other) => other.id !== plan.id)
    .flatMap((other) =>
      planCalledPlanIds(other).map((to) => ({ from: other.id, to })),
    );
  const offending = plan.nodes.filter(
    (node) =>
      isPlanJumpOut(node) &&
      node.target !== null &&
      wouldCloseCallCycle(calls, plan.id, node.target.planId),
  );
  if (offending.length > 0)
    throw new AgentPlanValidationError(
      offending.map((node) => ({
        nodeId: node.id,
        port: null,
        reason: "jumpCycle" as const,
      })),
    );
}
