import type { AgentPlanStepResult } from "./AgentPlan.js";

/** Whether a remote attempt lacks the proof required to release its workspace. */
export function isRemoteCloseoutUnconfirmed(
  step: AgentPlanStepResult,
): boolean {
  const session = step.session;
  const script = step.script;
  if (session) {
    if (session.runnerOwned && session.closeout === "not_needed") return false;
    if (session.runnerOwned || session.runnerJob)
      return session.closeout !== "confirmed";
    if (session.runner === "api" && session.closeout === "not_needed")
      return false;
  }
  if (script && (script.runnerOwned || script.runnerJob))
    return script.closeout !== "confirmed";
  const execution = step.execution;
  if (!execution || execution.target.kind !== "remote")
    return step.remote !== undefined;
  if (step.remote) return step.remote.closeout !== "confirmed";
  // The engine persists "running" before dispatching; a still-waiting node
  // without any attempt record, or an explicit not-started cancellation,
  // therefore never acquired a remote process.
  return !isUnstartedWait(step);
}

function isUnstartedWait(step: AgentPlanStepResult): boolean {
  return (
    (["waiting", "paused"].includes(step.status) ||
      step.cancellation === "not_started") &&
    !step.session &&
    !step.script
  );
}
