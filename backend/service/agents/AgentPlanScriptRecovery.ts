import {
  endTaggedProcesses,
  readScopeSince,
} from "@/backend/agents/cli/CliProcessScan";

import { removeScriptResources } from "./AgentPlanScriptResources";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

/** Reconciles an orphaned attempt using its inherited tag, never by trusting its persisted PID. */
export async function endInterruptedScript(
  step: AgentPlanStepResult,
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
    if (isConfirmed) await removeScriptResources(script.instanceId);
  } catch {
    isConfirmed = false;
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
