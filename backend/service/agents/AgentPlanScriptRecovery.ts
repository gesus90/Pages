import {
  endTaggedProcesses,
  readScopeSince,
} from "@/backend/agents/cli/CliProcessScan";

import { removeScriptResources } from "./AgentPlanScriptResources";
import { cleanupScanFailure } from "./AgentPlanCleanupFailure";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

/** Reconciles an orphaned attempt using its inherited tag, never by trusting its persisted PID. */
export async function endInterruptedScript(
  step: AgentPlanStepResult,
): Promise<AgentPlanStepResult> {
  return closeInterruptedScript(step);
}

/** Reconciles the owned script and reports a fixed cleanup failure to the caller. */
export async function endInterruptedScriptWithFailure(
  step: AgentPlanStepResult,
  onFailure: (failure: AgentPlanCleanupFailure) => void,
): Promise<AgentPlanStepResult> {
  return closeInterruptedScript(step, onFailure);
}

async function closeInterruptedScript(
  step: AgentPlanStepResult,
  onFailure?: (failure: AgentPlanCleanupFailure) => void,
): Promise<AgentPlanStepResult> {
  const script = step.script;
  if (!script || script.closeout === "confirmed") return step;
  let isConfirmed = false;
  try {
    const cleanup = await endTaggedProcesses(
      script.instanceId,
      await readScopeSince(script.startedAt),
    );
    isConfirmed = cleanup.remaining === 0;
    if (!isConfirmed)
      onFailure?.({
        stepId: step.id,
        kind: "local_script",
        reason: "processes_remaining",
      });
  } catch (error: unknown) {
    onFailure?.(cleanupScanFailure(step.id, "local_script", error));
    isConfirmed = false;
  }
  if (isConfirmed) {
    try {
      await removeScriptResources(script.instanceId);
    } catch {
      onFailure?.({
        stepId: step.id,
        kind: "local_script",
        reason: "resource_cleanup_failed",
      });
      isConfirmed = false;
    }
  }
  return {
    ...step,
    script: {
      ...script,
      endedAt: new Date().toISOString(),
      closeout: isConfirmed ? "confirmed" : "failed",
      failure: script.failure ?? (isConfirmed ? "interrupted" : "cleanup"),
    },
  };
}
