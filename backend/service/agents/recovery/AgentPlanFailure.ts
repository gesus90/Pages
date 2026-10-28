import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanFailureClass,
  AgentPlanRecoveryReason,
} from "@/definition/AgentPlanRecovery";

const FAILURE_CLASSES: Readonly<Record<string, AgentPlanFailureClass>> = {
  provider_unreachable: "provider",
  provider_unavailable: "provider",
  provider_rate_limited: "provider",
  provider_quota_exhausted: "provider",
  opencode_free_tier_refused: "provider",
  providerFailed: "provider",
  connectionUnavailable: "configuration",
  modelUnavailable: "configuration",
  accessDenied: "approval",
  roleMissing: "approval",
  plan_runner_permission_denied: "approval",
  provider_permission_denied: "approval",
  plan_group_acceptance_failed: "business",
  opencode_acceptance_failed: "business",
  opencode_acceptance_unavailable: "configuration",
  opencode_acceptance_contract_unavailable: "configuration",
  opencode_acceptance_interrupted: "interruption",
  plan_work_gate_failed: "business",
  plan_work_gate_unavailable: "configuration",
  plan_work_gate_write_required: "approval",
  plan_context_changed: "configuration",
  plan_definition_changed: "configuration",
  plan_model_unavailable: "configuration",
  parameter_ticket_changed: "configuration",
  workspace_path_changed: "configuration",
  timeout: "timeout",
  plan_script_timeout: "timeout",
  plan_script_interrupted: "interruption",
  plan_script_cleanup: "cleanup",
  plan_script_permission_denied: "approval",
  plan_script_interpreter_unavailable: "configuration",
  plan_script_profile_missing: "configuration",
  check_timeout: "timeout",
  plan_interrupted: "interruption",
  plan_group_session_lost: "interruption",
  plan_loop_session_lost: "interruption",
  plan_acp_session_failed: "interruption",
  plan_claude_acp_session_failed: "interruption",
  opencode_acp_session_failed: "interruption",
  plan_closeout_failed: "cleanup",
  plan_script_exit: "business",
  plan_script_signal: "interruption",
  plan_script_output_limit: "business",
  plan_script_encoding: "business",
  plan_script_input_required: "configuration",
  plan_script_input_limit: "configuration",
  plan_script_result_invalid: "configuration",
  plan_script_result_sensitive: "configuration",
  plan_script_review_failed: "business",
  plan_script_spawn: "configuration",
  plan_script_unavailable: "configuration",
  acp_worker_limit: "interruption",
  acp_output_overflow: "business",
  acp_worker_unit_unavailable: "configuration",
  acp_session_resume_failed: "interruption",
  cli_not_logged_in: "configuration",
};

/** Unknown failures remain terminal; an explicit stop always overrides classification. */
export function classifyPlanFailure(
  step: AgentPlanStepResult,
): AgentPlanFailureClass {
  if (step.status === "cancelled") return "cancelled";
  const error = step.error ?? "";
  return Object.hasOwn(FAILURE_CLASSES, error)
    ? FAILURE_CLASSES[error]
    : "terminal";
}

/** Marks only known reparable failures, without claiming that any effect is safe to replay. */
export function planRecoveryReason(
  run: AgentPlanRun,
): AgentPlanRecoveryReason | undefined {
  if (run.stopRequested || run.status === "cancelled") return undefined;
  const failures = run.steps.filter((step) => step.status === "failed");
  if (
    failures.length === 0 ||
    failures.some((step) => classifyPlanFailure(step) === "terminal")
  )
    return undefined;
  return { state: "recoverable", requiresReconciliation: true };
}
