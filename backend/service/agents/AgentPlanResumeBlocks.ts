import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type {
  AgentPlanControl,
  AgentPlanResumeAction,
  AgentPlanResumeBlock,
} from "@/definition/AgentPlanControl";
import type { AgentPlanRecoveryBlocker } from "@/definition/AgentPlanRecovery";

/** What lifts a refusal of the plan itself, for the codes whose lift is an action. */
const ISSUE_ACTIONS: Readonly<Record<string, AgentPlanResumeAction>> = {
  plan_script_permission_denied: "admin_mode",
  plan_workspace_waiting: "wait",
};

/** What lifts a block of the recovery view, where the person can lift it at once. */
const RECOVERY_ACTIONS: Readonly<
  Partial<Record<AgentPlanRecoveryBlocker, AgentPlanResumeAction>>
> = {
  run_active: "wait",
  cleanup_unconfirmed: "release",
  plan_context_changed: "restart",
  plan_definition_changed: "restart",
  plan_completed_changed: "restart",
  checkpoint_mismatch: "restart",
  branching_unsupported: "restart",
  no_safe_state: "restart",
};

/** The block a refusal of the plan names, such as a missing admin mode or a changed plan. */
export function resumeBlockFromIssue(
  code: string,
  holderRunId?: string,
): AgentPlanResumeBlock {
  return {
    code,
    action: ISSUE_ACTIONS[code] ?? "none",
    ...(holderRunId ? { holderRunId } : {}),
  };
}

/** The block the recovery view names for an ended run. */
export function resumeBlockFromRecovery(
  reason: AgentPlanRecoveryBlocker,
): AgentPlanResumeBlock {
  return { code: reason, action: RECOVERY_ACTIONS[reason] ?? "none" };
}

const RECOVERY_REFUSALS: ReadonlySet<string> = new Set(["cleanup_unconfirmed"]);

/**
 * The refusal of a continuation the control does not allow.
 *
 * @param control - The control that holds the block.
 * @returns The error that names the same reason the interface shows.
 */
export function resumeRefusal(control: AgentPlanControl): Error {
  const code = control.resumeBlock?.code ?? control.issue;
  if (code && RECOVERY_REFUSALS.has(code))
    return new AgentPlanRecoveryError("cleanup_unconfirmed");
  return new AgentError(
    code && isAgentErrorCode(code) ? code : "plan_run_unavailable",
  );
}
