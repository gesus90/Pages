import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanNode } from "@/backend/agents/AgentPlanInput";

import { assessPlanScriptResult } from "./AgentPlanScriptResult";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerExecution } from "@/definition/RunnerExecution";

/** Applies the pinned script policy before a remote result can create a checkpoint. */
export function recordRemoteScriptResult(
  snapshot: unknown,
  command: RunnerExecution | undefined,
  result: AgentPlanStepResult,
): AgentPlanStepResult {
  if (command?.program.kind !== "script" || result.status !== "succeeded")
    return result;
  const basis = readAgentObject(snapshot);
  const steps: readonly unknown[] = Array.isArray(basis.remoteSteps)
    ? basis.remoteSteps
    : [];
  const pinned = steps.find(
    (entry) => readAgentObject(readAgentObject(entry).step).id === result.id,
  );
  const step = readPlanNode(readAgentObject(pinned).step);
  if (step.type !== "script") throw new Error("Remote script node missing");
  return { ...result, ...assessPlanScriptResult(step, result) };
}
