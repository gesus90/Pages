import type { AgentPlanStepResult } from "./AgentPlan.js";

/** Whether a remote attempt lacks the proof required to release its workspace. */
export function isRemoteCloseoutUnconfirmed(
  step: AgentPlanStepResult,
): boolean {
  if (step.execution?.target.kind !== "remote")
    return step.remote !== undefined;
  if (step.remote) return step.remote.closeout !== "confirmed";
  // The engine persists "running" before dispatching; a still-waiting node
  // without any attempt record, or an explicit not-started cancellation,
  // therefore never acquired a remote process.
  return !(
    (step.status === "waiting" || step.cancellation === "not_started") &&
    !step.session &&
    !step.script
  );
}
