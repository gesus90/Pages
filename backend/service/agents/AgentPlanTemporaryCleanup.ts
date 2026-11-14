import {
  removePlanTemporaryRun,
  temporaryPlanRunIds,
} from "@/backend/agents/PlanRunTemporaryDirectory";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { hasNoSessionProcesses } from "./AgentPlanRecovery";

import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Deletes scratch only for terminal runs with independently confirmed process cleanup. */
export async function cleanupEndedPlanTemporaryDirectory(
  run: AgentPlanRun,
): Promise<void> {
  if (isActivePlanRun(run.status) || !(await hasNoSessionProcesses(run)))
    return;
  await removePlanTemporaryRun(run.id);
}

/** Reconciles disk leftovers after startup has reconciled interrupted sessions and scripts. */
export async function cleanupOrphanedPlanTemporaryDirectories(
  find: (runId: string) => Promise<AgentPlanRun | null>,
): Promise<void> {
  for (const runId of await temporaryPlanRunIds()) {
    const run = await find(runId);
    // Unknown owners remain: absence of a record alone does not prove process end.
    if (run) await cleanupEndedPlanTemporaryDirectory(run);
  }
}
