import type { AgentPlanInvocationRepository } from "@/backend/database/repositories/agent/AgentPlanInvocationRepository";

/**
 * Whether a call that waits for its turn waits, through other runs, for the run that made it.
 * @param invocations - The call register.
 * @param sourceRunId - The calling run, which waits for the call.
 * @param owners - The runs that hold the target plan or a resource the called run needs.
 * @returns `true` when one of the owners is the calling run itself or waits, directly or through further
 * calls, for it: the call could then never start and nobody would ever go on.
 * @remarks
 * Only waits count: a run that goes on at once does not wait for its call,
 * so it releases what it holds once it ends, and the call may simply queue.
 */
export async function isWaitCycle(
  invocations: Pick<AgentPlanInvocationRepository, "waitingTargets">,
  sourceRunId: string,
  owners: readonly string[],
): Promise<boolean> {
  const pending = [...owners];
  const seen = new Set<string>();
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (id === sourceRunId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(await invocations.waitingTargets(id)));
  }
  return false;
}
