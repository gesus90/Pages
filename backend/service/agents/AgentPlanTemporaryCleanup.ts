import {
  removePlanTemporaryRun,
  removePlanTemporaryStep,
  temporaryPlanRunIds,
} from "@/backend/agents/PlanRunTemporaryDirectory";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { logCaughtError } from "@/backend/logging/Logger";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { hasNoSessionProcesses } from "./AgentPlanRecovery";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { NodeRun } from "./AgentPlanStepContext";

/** Removes the step's temporary directory when a standalone step finished with confirmed closeout and was not paused. */
export async function cleanupFinishedStepTemporaryDirectory(
  node: NodeRun,
  reason: unknown,
): Promise<void> {
  if (
    node.sessionGroup ||
    node.record?.closeout !== "confirmed" ||
    reason instanceof AgentPlanPausedError
  )
    return;
  await removePlanTemporaryStep({
    runId: node.run.id,
    stepId: node.step.step.id,
  }).catch((error: unknown) => logCaughtError("AgentPlanStepRunner", error));
}

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
