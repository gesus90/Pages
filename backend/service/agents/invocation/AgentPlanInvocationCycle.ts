import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentPlanInvocationRepository } from "@/backend/database/repositories/agent/AgentPlanInvocationRepository";

/** The longest chain of calls that is followed back; a longer one is a cycle in all but name. */
const CHAIN_LIMIT = 64;

/**
 * Refuses a call that would close a cycle in the chain of calls it belongs to.
 * @param invocations - The call register.
 * @param source - The calling run and its plan.
 * @param targetPlanId - The plan the call would run.
 * @throws {AgentError} `plan_jump_cycle` when the target plan is the calling plan or any plan that,
 * directly or through other calls, called the calling run.
 * @remarks
 * The chain is read from the register at the time of the call, not from the
 * plans, so it covers what really runs now. It applies to every wait,
 * including a call that goes on at once.
 */
export async function requireNoCallCycle(
  invocations: Pick<AgentPlanInvocationRepository, "findByTargetRun">,
  source: { readonly runId: string; readonly planId: string },
  targetPlanId: string,
): Promise<void> {
  const plans = new Set([source.planId]);
  let runId = source.runId;
  for (let depth = 0; depth < CHAIN_LIMIT; depth += 1) {
    const call = await invocations.findByTargetRun(runId);
    if (!call) break;
    plans.add(call.sourcePlanId);
    runId = call.sourceRunId;
  }
  if (plans.has(targetPlanId)) throw new AgentError("plan_jump_cycle");
}
