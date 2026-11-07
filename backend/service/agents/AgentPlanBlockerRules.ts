import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";

import { explicitPlanBlocker } from "./AgentPlanAcceptance";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentExecutionErrorCode } from "@/backend/error/AgentExecutionErrors";
import type {
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type {
  AgentPlanBlockerClass,
  AgentPlanFailureStop,
  AgentPlanRetryAttempt,
} from "@/definition/AgentPlanRetry";
import type { AgentPlanAcceptance } from "@/definition/AgentPlanSession";

/**
 * The one assignment of every error code to a blocker class (PAGE-210).
 *
 * @remarks
 * The record type makes it complete: a new code in `AgentErrors.ts` does not
 * compile until it has its class here. Codes that no step produces today, such
 * as those of connection management, need a class as well, because a step may
 * surface them later.
 *
 * `harm` also holds what a repeat cannot make safe: a process that may still
 * run, effects nobody can reconcile, and every missing right or isolation,
 * which only a person may grant. `open` holds what a person has to look at when
 * no agent turn exists to send it back to.
 */
const ERROR_CLASSES: Readonly<Record<AgentErrorCode, AgentPlanBlockerClass>> = {
  plan_local_owner_unverified: "harm",
  plan_payload_missing: "harm",
  plan_payload_corrupt: "harm",
  plan_runner_control_update_required: "open",
  plan_workspace_waiting: "infrastructure",
  plan_acceptance_failed: "open",
  plan_acceptance_unavailable: "infrastructure",
  plan_acceptance_contract_unavailable: "harm",
  plan_acceptance_interrupted: "infrastructure",
  antigravity_runner_update_required: "open",
  antigravity_acp_unsupported: "open",
  antigravity_acp_session_failed: "infrastructure",
  antigravity_configuration_unmanaged: "harm",
  antigravity_pica_unverified: "harm",
  plan_work_gate_failed: "open",
  plan_work_gate_unavailable: "open",
  plan_work_gate_write_required: "harm",
  parameter_asset_conflict: "open",
  parameter_asset_write_denied: "harm",
  parameter_asset_output_invalid: "form",
  zai_account_type_invalid: "open",
  profile_management_retired: "open",
  agent_tool_not_ready: "open",
  opencode_acceptance_failed: "open",
  opencode_acceptance_unavailable: "infrastructure",
  opencode_acceptance_contract_unavailable: "harm",
  opencode_acceptance_interrupted: "infrastructure",
  plan_script_result_invalid: "form",
  plan_script_result_sensitive: "harm",
  plan_script_review_failed: "open",
  opencode_permission_mode_required: "harm",
  opencode_chat_mode_required: "harm",
  opencode_configuration_unmanaged: "harm",
  opencode_acp_unsupported: "open",
  opencode_acp_session_failed: "infrastructure",
  opencode_free_tier_refused: "open",
  plan_json_invalid: "form",
  plan_number_invalid: "form",
  plan_run_unavailable: "open",
  plan_run_unreadable: "open",
  plan_start_rejection_record_failed: "infrastructure",
  plan_continuation_deleted: "open",
  plan_completed_changed: "open",
  plan_pause_required: "open",
  plan_remote_unavailable: "open",
  plan_invalid: "open",
  plan_script_invalid: "open",
  plan_script_profile_missing: "open",
  plan_script_interpreter_unavailable: "open",
  plan_script_permission_denied: "harm",
  plan_script_platform_unsupported: "open",
  plan_script_input_required: "open",
  plan_script_input_limit: "open",
  plan_script_spawn: "open",
  plan_script_exit: "open",
  plan_git_closeout_invalid: "open",
  plan_git_closeout_state: "open",
  plan_git_closeout_conflict: "harm",
  plan_git_closeout_secrets: "harm",
  plan_git_closeout_remote: "harm",
  plan_git_closeout_permission: "harm",
  plan_git_closeout_check: "open",
  plan_git_closeout_unreachable: "infrastructure",
  plan_git_closeout_unverified: "harm",
  plan_git_closeout_cleanup: "open",
  plan_git_closeout_result_invalid: "harm",
  plan_script_signal: "open",
  plan_script_timeout: "open",
  plan_script_cancelled: "open",
  plan_script_output_limit: "form",
  plan_script_encoding: "form",
  plan_script_credentials: "harm",
  plan_script_io: "infrastructure",
  plan_script_cleanup: "harm",
  plan_script_interrupted: "harm",
  plan_script_unavailable: "open",
  template_name_required: "open",
  template_name_taken: "open",
  template_not_found: "open",
  template_owner_only: "open",
  template_invalid: "open",
  plan_access_denied: "harm",
  plan_conflict: "open",
  plan_name_taken: "open",
  plan_project_owner_only: "harm",
  plan_running: "open",
  plan_cycle: "open",
  plan_binding_invalid: "open",
  plan_workspace_conflict: "harm",
  plan_context_changed: "harm",
  plan_directory_required: "open",
  plan_step_failed: "open",
  plan_dependency_failed: "open",
  plan_interrupted: "infrastructure",
  plan_run_option_unsupported: "harm",
  plan_mcp_unavailable: "open",
  codex_permission_mode_required: "harm",
  claude_permission_mode_required: "harm",
  plan_acp_adapter_missing: "open",
  plan_claude_acp_adapter_missing: "open",
  plan_acp_adapter_unsupported: "open",
  pica_native_artifact_unavailable: "open",
  plan_claude_acp_adapter_unsupported: "open",
  plan_model_unavailable: "open",
  plan_reasoning_unsupported: "open",
  plan_permission_mode_unenforceable: "harm",
  plan_yolo_isolation_unavailable: "harm",
  plan_codex_configuration_unmanaged: "harm",
  plan_acp_session_failed: "infrastructure",
  acp_session_resume_failed: "infrastructure",
  plan_claude_acp_session_failed: "infrastructure",
  plan_definition_changed: "harm",
  plan_placeholder_unresolved: "open",
  run_notes_unsupported: "open",
  plan_runner_lost: "harm",
  acp_result_limit: "form",
  plan_runner_storage_failed: "infrastructure",
  plan_runner_event_limit: "form",
  plan_runner_result_limit: "form",
  plan_history_unavailable: "infrastructure",
  plan_history_corrupt: "harm",
  plan_runner_update_required: "open",
  plan_runner_payload_update_required: "open",
  plan_runner_admission_failed: "infrastructure",
  plan_runner_failed: "infrastructure",
  plan_runner_incomplete: "infrastructure",
  plan_runner_session_failed: "infrastructure",
  plan_runner_permission_denied: "harm",
  plan_group_acceptance_failed: "open",
  plan_group_session_unsupported: "open",
  plan_group_session_lost: "infrastructure",
  plan_loop_invalid: "open",
  plan_loop_nested: "open",
  plan_loop_runs_invalid: "open",
  plan_loop_runs_unavailable: "open",
  plan_loop_while_invalid: "form",
  plan_loop_while_type: "form",
  plan_loop_while_limit: "open",
  plan_stack_invalid: "open",
  plan_stack_content_missing: "open",
  plan_loop_condition_source: "open",
  plan_loop_condition_path: "open",
  plan_loop_output_missing: "form",
  plan_loop_output_invalid: "form",
  plan_loop_output_ambiguous: "form",
  plan_loop_condition_field: "form",
  plan_loop_condition_type: "form",
  plan_loop_session_lost: "infrastructure",
  plan_decision_input_invalid: "form",
  plan_event_prompt_empty: "form",
  plan_event_prompt_too_large: "form",
  plan_activation_limit: "open",
  plan_branching_revision: "open",
  plan_session_unavailable: "infrastructure",
  plan_stop_unconfirmed: "harm",
  plan_closeout_failed: "harm",
  workspace_invalid: "open",
  workspace_project_unsupported: "open",
  workspace_management_denied: "harm",
  workspace_access_denied: "harm",
  workspace_not_found: "open",
  workspace_conflict: "open",
  workspace_roots_missing: "open",
  workspace_path_invalid: "open",
  workspace_path_unavailable: "open",
  workspace_path_denied: "harm",
  workspace_path_contains_instance: "harm",
  workspace_path_outside_roots: "harm",
  workspace_path_changed: "harm",
  workspace_path_conflict: "harm",
  workspace_in_use: "open",
  workspace_running: "open",
  configuration_invalid: "open",
  parameter_invalid: "open",
  parameter_number_invalid: "open",
  parameter_ticket_unavailable: "open",
  parameter_asset_unavailable: "open",
  parameter_asset_type_unsupported: "open",
  parameter_asset_transfer_unsupported: "open",
  parameter_asset_reference_unsupported: "open",
  parameter_assets_too_large: "open",
  parameter_ticket_changed: "open",
  parameter_required: "open",
  parameter_reference_unavailable: "open",
  profile_in_use: "open",
  profile_conflict: "open",
  profile_running: "open",
  profile_limit_reached: "open",
  profile_scope_invalid: "open",
  personal_access_missing: "open",
  personal_access_selection_required: "open",
  agent_usage_denied: "harm",
  agent_inactive: "open",
  model_assignment_missing: "open",
  system_function_in_use: "open",
  profile_invalid: "open",
  profile_not_found: "open",
  profile_target_invalid: "open",
  function_invalid: "open",
  assignment_exists: "open",
  assignment_not_found: "open",
  connection_in_use: "open",
  catalog_unsupported: "open",
  catalog_interval_invalid: "open",
  catalog_limit_exceeded: "open",
  name_required: "open",
  name_too_long: "open",
  name_taken: "open",
  provider_invalid: "open",
  provider_immutable: "open",
  api_key_required: "open",
  api_key_invalid_format: "open",
  test_model_invalid: "open",
  reasoning_effort_invalid: "open",
  reasoning_effort_unsupported: "open",
  connection_limit_reached: "open",
  connection_not_found: "open",
  connection_scope_invalid: "open",
  secret_unavailable: "harm",
  check_in_progress: "infrastructure",
  check_timeout: "infrastructure",
  test_model_required: "open",
  provider_unreachable: "infrastructure",
  provider_auth_failed: "open",
  provider_permission_denied: "harm",
  provider_quota_exhausted: "infrastructure",
  provider_rate_limited: "infrastructure",
  provider_model_not_found: "open",
  provider_request_rejected: "open",
  provider_unavailable: "infrastructure",
  provider_bad_response: "infrastructure",
  cli_not_found: "open",
  cli_not_executable: "open",
  cli_isolation_unavailable: "harm",
  acp_worker_unit_unavailable: "open",
  acp_worker_limit: "infrastructure",
  acp_output_overflow: "form",
  cli_not_logged_in: "open",
  cli_auth_failed: "open",
  cli_check_failed: "open",
  cli_unexpected_output: "infrastructure",
  login_in_progress: "open",
  login_limit_reached: "infrastructure",
  login_not_running: "open",
  login_expired: "open",
  login_cancelled: "open",
  login_failed: "open",
  login_code_invalid: "open",
  login_code_rejected: "open",
  login_callback_invalid: "open",
  login_callback_unreachable: "open",
  login_device_auth_unavailable: "open",
  credential_cleanup_failed: "harm",
};

/** The same assignment for the codes of `AgentExecutionError`, which a step reports as well. */
const EXECUTION_ERROR_CLASSES: Readonly<
  Record<AgentExecutionErrorCode, AgentPlanBlockerClass>
> = {
  invalidInput: "open",
  accessDenied: "harm",
  profileSelectionRequired: "open",
  roleMissing: "harm",
  connectionUnavailable: "open",
  accessUnverified: "harm",
  modelUnavailable: "open",
  picaModelSelectionRequired: "open",
  picaZenUnsupported: "open",
  reasoningUnsupported: "open",
  requestBusy: "infrastructure",
  cancelled: "open",
  timeout: "open",
  providerFailed: "infrastructure",
  invalidOutput: "form",
  credentialsInText: "harm",
};

const CODE_CLASSES: Readonly<Record<string, AgentPlanBlockerClass>> = {
  ...ERROR_CLASSES,
  ...EXECUTION_ERROR_CLASSES,
};

/** The issues of a closing report that say its form is wrong, not that the work is open. */
const REPORT_FORM_ISSUES: ReadonlySet<string> = new Set([
  "report_missing",
  "report_invalid",
]);

const INCOMPLETE_REPORT_ISSUE =
  /^(?:todo_missing|criterion_missing|evidence_missing):/u;

/** The acceptance codes whose class depends on what the report says. */
const ACCEPTANCE_CODES: ReadonlySet<string> = new Set([
  "plan_acceptance_failed",
  "plan_group_acceptance_failed",
  "opencode_acceptance_failed",
]);

/** A failed step, as far as its class depends on it. */
export interface PlanStepFailureFacts {
  readonly error: string | null | undefined;
  readonly acceptance?: AgentPlanAcceptance | null;
  readonly output?: string | null;
}

/**
 * The class of one error code.
 *
 * @param code - The stored code of a step.
 * @returns Its class; a code nobody knows counts as functionally open.
 */
export function planBlockerClassOf(code: unknown): AgentPlanBlockerClass {
  return typeof code === "string" && Object.hasOwn(CODE_CLASSES, code)
    ? CODE_CLASSES[code]
    : "open";
}

/** Whether the only thing wrong with the report is its form, so the work may well be done. */
function isFormOnly(acceptance: AgentPlanAcceptance): boolean {
  if (acceptance.issues.some((issue) => REPORT_FORM_ISSUES.has(issue)))
    return true;
  return (
    acceptance.issues.length > 0 &&
    acceptance.issues.every((issue) => INCOMPLETE_REPORT_ISSUE.test(issue))
  );
}

/**
 * The class of a failed step, with what its closing report adds to the code.
 *
 * @param facts - The code of the step, its acceptance and its final answer.
 * @returns The class that decides how the step goes on.
 *
 * @remarks
 * An agent that declares `blocked` asks for a person, for instance about a
 * diverged `main` or work of somebody else, so it never gets pressed to go on.
 * A missing or unreadable report comes before everything else: nothing in it
 * can be trusted yet, and the agent can often simply write it.
 */
export function classifyPlanStepFailure(
  facts: PlanStepFailureFacts,
): AgentPlanBlockerClass {
  if (!ACCEPTANCE_CODES.has(facts.error ?? ""))
    return planBlockerClassOf(facts.error);
  const { acceptance } = facts;
  if (
    acceptance?.issues.includes("business_blocked") ||
    (!acceptance && explicitPlanBlocker(facts.output ?? "") === "blocked")
  )
    return "harm";
  return acceptance && isFormOnly(acceptance) ? "form" : "open";
}

/**
 * Whether the agent can be asked to repair this failure.
 *
 * @param failureClass - The class of the failure.
 * @param facts - The failure; a regular final answer is what an open failure is judged on.
 * @returns `false` where no agent turn exists that a repair could go back to, such as a refused start.
 */
export function canReturnPlanFailureToAgent(
  failureClass: AgentPlanBlockerClass,
  facts: PlanStepFailureFacts,
): boolean {
  if (failureClass === "form") return true;
  if (failureClass !== "open") return false;
  return ACCEPTANCE_CODES.has(facts.error ?? "") || Boolean(facts.acceptance);
}

/** The class of a stored attempt; a record written before the classes names only its code. */
function attemptClass(attempt: AgentPlanRetryAttempt): AgentPlanBlockerClass {
  return attempt.failureClass ?? planBlockerClassOf(attempt.code);
}

/**
 * How many attempts of a sequence failed with this class.
 *
 * @param attempts - The failed attempts of one sequence.
 * @param failureClass - The class to count; each class has its own budget.
 * @returns The number of failed attempts of the class.
 */
export function failedPlanAttempts(
  attempts: readonly AgentPlanRetryAttempt[],
  failureClass: AgentPlanBlockerClass,
): number {
  return attempts.filter((attempt) => attemptClass(attempt) === failureClass)
    .length;
}

/**
 * The reason a failed step stopped, naming its class and its attempts.
 *
 * @param result - The final result of the step.
 * @returns What a person and a client read about the stop.
 */
export function planFailureStop(
  result: Pick<Partial<AgentPlanStepResult>, "error" | "session" | "output">,
): AgentPlanFailureStop {
  const retry = result.session?.retry;
  const failureClass =
    retry?.failureClass ??
    classifyPlanStepFailure({
      error: result.error,
      acceptance: result.session?.acceptance,
      output: result.output,
    });
  return {
    failureClass,
    attempts: Math.max(
      failedPlanAttempts(retry?.attempts ?? [], failureClass),
      1,
    ),
    maximumAttempts: PLAN_BLOCKER_RETRIES[failureClass] + 1,
    totalAttempts: Math.max(retry?.attempts.length ?? 0, 1),
  };
}

/**
 * The stop of a node; a loop reports the member that ended it, because only that one knows the attempts.
 *
 * @param run - The run of the node.
 * @param node - The node.
 * @param result - The final result of the node.
 * @returns What a person and a client read about the stop.
 */
export function planNodeStop(
  run: AgentPlanRun,
  node: Pick<AgentPlanNode, "id">,
  result: Pick<Partial<AgentPlanStepResult>, "error" | "session" | "output">,
): AgentPlanFailureStop {
  const member = run.loops
    ?.find((loop) => loop.id === node.id)
    ?.iterations.at(-1)
    ?.nodes.find(
      (entry) => entry.status === "failed" && entry.error === result.error,
    );
  return planFailureStop(member ?? result);
}
