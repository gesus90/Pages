import { AGENT_ERROR_MESSAGES } from "@/backend/error/AgentErrors";

import type {
  AgentRunErrorClass,
  AgentRunErrorClassification,
} from "@/definition/AgentRunDiagnosis";

/** The code of a failure that carries no stable code of its own. */
export const UNKNOWN_ERROR_CODE = "unknown_error";

/** What a person can do about each class; the same text on every transport. */
const CLASS_HINTS: Readonly<Record<AgentRunErrorClass, string>> = {
  model:
    "Check the model connection, its quota and whether the model is still offered, then choose another model or wait for the reset and resume the run.",
  tool_missing:
    "Install or log in the missing tool (CLI, adapter, interpreter) at the execution host under Settings → Agents → Tools, then resume the run.",
  timeout:
    "Raise the time limit of the step or split the work into smaller steps, then resume the run.",
  git: "Open the workspace and resolve the Git state named in the step result (conflicts, remote, permissions), then resume the run.",
  workspace_busy:
    "Wait until the other run releases the workspace, stop or release that run, or give the plan its own workspace copy.",
  permission:
    "Grant the executing account access to the plan, workspace, ticket or tool named in the step, or start the run with an account that has it.",
  plan_invalid:
    "Open the plan, fix the node or binding named by the plan check, save it and start a new run.",
  process_crash:
    "Read the diagnostics and logs of the step. If the process ended without a cause, resume the run; if it repeats, report the failure with the run ID.",
  runner_unavailable:
    "Check that the runner or execution host is connected and up to date under Settings → Agents, then resume the run.",
  acceptance_failed:
    "Read the report of the step: the agent left work open or could not prove it. Adjust the instruction or the criteria and resume the run.",
  unknown:
    "Read the diagnostics, events and logs of the step with the run ID. The failure has no known class yet.",
};

/** The short message of a class when a code has none of its own. */
const CLASS_MESSAGES: Readonly<Record<AgentRunErrorClass, string>> = {
  model: "The model or its provider refused or could not answer.",
  tool_missing: "A tool the step needs is missing or not ready.",
  timeout: "The step ran out of time.",
  git: "A Git operation of the step failed.",
  workspace_busy: "The workspace is in use by another run.",
  permission: "The executing account lacks a permission.",
  plan_invalid: "The plan or one of its nodes is invalid.",
  process_crash: "The process of the step ended unexpectedly.",
  runner_unavailable: "The runner or execution host is not available.",
  acceptance_failed: "The agent did not prove that its work is complete.",
  unknown: "The failure has no known class.",
};

const EXACT_CODES: Readonly<Record<AgentRunErrorClass, ReadonlySet<string>>> = {
  model: new Set([
    "plan_model_unavailable",
    "plan_reasoning_unsupported",
    "model_assignment_missing",
    "opencode_free_tier_refused",
    "zai_account_type_invalid",
    "agent_usage_denied",
    "agent_inactive",
    "modelUnavailable",
    "providerFailed",
    "connectionUnavailable",
    "reasoningUnsupported",
    "acp_result_limit",
  ]),
  tool_missing: new Set([
    "agent_tool_not_ready",
    "plan_acp_adapter_missing",
    "plan_claude_acp_adapter_missing",
    "plan_acp_adapter_unsupported",
    "plan_claude_acp_adapter_unsupported",
    "plan_codex_configuration_unmanaged",
    "opencode_acp_unsupported",
    "opencode_configuration_unmanaged",
    "antigravity_acp_unsupported",
    "antigravity_configuration_unmanaged",
    "plan_script_interpreter_unavailable",
    "plan_script_profile_missing",
    "plan_script_spawn",
    "plan_mcp_unavailable",
    "pica_native_artifact_unavailable",
  ]),
  timeout: new Set(["timeout", "plan_script_timeout", "check_timeout"]),
  git: new Set(),
  workspace_busy: new Set([
    "plan_workspace_waiting",
    "plan_workspace_conflict",
    "plan_running",
    "plan_run_unavailable",
    "requestBusy",
    "acp_worker_limit",
  ]),
  permission: new Set([
    "plan_access_denied",
    "plan_script_permission_denied",
    "plan_runner_permission_denied",
    "plan_permission_mode_unenforceable",
    "plan_yolo_isolation_unavailable",
    "plan_work_gate_write_required",
    "parameter_asset_write_denied",
    "opencode_permission_mode_required",
    "opencode_chat_mode_required",
    "codex_permission_mode_required",
    "claude_permission_mode_required",
    "plan_project_owner_only",
    "accessDenied",
    "credentialsInText",
  ]),
  plan_invalid: new Set([
    "plan_invalid",
    "plan_cycle",
    "plan_binding_invalid",
    "plan_script_invalid",
    "plan_definition_changed",
    "plan_context_changed",
    "plan_directory_required",
    "plan_placeholder_unresolved",
    "plan_conflict",
    "plan_branching_revision",
    "plan_activation_limit",
    "plan_script_input_required",
    "plan_script_input_limit",
    "plan_run_option_unsupported",
    "run_notes_unsupported",
    "configuration_invalid",
    "invalidInput",
  ]),
  process_crash: new Set([
    "plan_interrupted",
    "plan_runner_lost",
    "plan_runner_failed",
    "plan_runner_incomplete",
    "plan_runner_storage_failed",
    "plan_runner_event_limit",
    "plan_runner_result_limit",
    "plan_closeout_failed",
    "plan_stop_unconfirmed",
    "plan_session_unavailable",
    "plan_terminal_question",
    "plan_local_owner_unverified",
    "plan_local_launch_invalid",
    "plan_payload_missing",
    "plan_payload_corrupt",
    "plan_history_unavailable",
    "plan_history_corrupt",
    "acp_output_overflow",
    "acp_input_too_large",
    "invalidOutput",
  ]),
  runner_unavailable: new Set([
    "plan_remote_unavailable",
    "plan_runner_admission_failed",
    "plan_runner_update_required",
    "plan_runner_payload_update_required",
    "plan_runner_control_update_required",
    "antigravity_runner_update_required",
    "acp_worker_unit_unavailable",
    "plan_script_unavailable",
    "plan_script_platform_unsupported",
  ]),
  acceptance_failed: new Set([
    "plan_acceptance_failed",
    "plan_acceptance_unavailable",
    "plan_acceptance_contract_unavailable",
    "plan_acceptance_interrupted",
    "opencode_acceptance_failed",
    "opencode_acceptance_unavailable",
    "opencode_acceptance_contract_unavailable",
    "opencode_acceptance_interrupted",
    "plan_group_acceptance_failed",
    "plan_work_gate_failed",
    "plan_work_gate_unavailable",
    "plan_script_review_failed",
    "plan_script_result_invalid",
    "plan_script_result_sensitive",
  ]),
  unknown: new Set(),
};

/** Families of codes that share a prefix or a stem. */
const PATTERNS: readonly (readonly [RegExp, AgentRunErrorClass])[] = [
  [/^plan_git_closeout_/u, "git"],
  [/^provider_/u, "model"],
  [/^api_key_/u, "model"],
  [/^reasoning_effort_/u, "model"],
  [/^cli_/u, "tool_missing"],
  [
    /^plan_script_(?:exit|signal|io|cleanup|interrupted|output_limit|encoding)$/u,
    "process_crash",
  ],
  [/^plan_(?:claude_)?acp_session_failed$/u, "process_crash"],
  [/^(?:opencode|antigravity)_acp_session_failed$/u, "process_crash"],
  [/^acp_session_resume_failed$/u, "process_crash"],
  [/^plan_runner_session_failed$/u, "process_crash"],
  [/^plan_(?:group|loop)_session_lost$/u, "process_crash"],
  [/^plan_loop_/u, "plan_invalid"],
  [/^plan_stack_/u, "plan_invalid"],
  [/^plan_decision_/u, "plan_invalid"],
  [/^plan_event_prompt_/u, "plan_invalid"],
  [/^plan_asset_/u, "plan_invalid"],
  [/^parameter_/u, "plan_invalid"],
  [/^plan_(?:json|number|boolean)_invalid$/u, "plan_invalid"],
  [/^workspace_(?:in_use|running)$/u, "workspace_busy"],
  [/^workspace_.*(?:denied|access)/u, "permission"],
  [/^workspace_/u, "plan_invalid"],
];

/**
 * Finds the class of a stored error code.
 *
 * @param code - The code a step or run stores.
 * @returns The class; `unknown` for a code no rule names.
 */
export function classifyAgentRunErrorCode(code: string): AgentRunErrorClass {
  for (const [name, codes] of Object.entries(EXACT_CODES))
    if (codes.has(code) && isClassName(name)) return name;
  for (const [pattern, errorClass] of PATTERNS)
    if (pattern.test(code)) return errorClass;
  return "unknown";
}

function isClassName(name: string): name is AgentRunErrorClass {
  return name in CLASS_HINTS;
}

function isKnownMessage(
  code: string,
): code is keyof typeof AGENT_ERROR_MESSAGES {
  return Object.hasOwn(AGENT_ERROR_MESSAGES, code);
}

/**
 * Classifies the error of a failed step or run.
 *
 * @param error - The stored error: a stable code, or free text of an old record.
 * @returns Class, stable code, short message and hint; `unknown` and
 * `unknown_error` when the text names no code.
 *
 * @remarks
 * Records written before the classes existed carry the same codes, so old
 * runs are classified the same way when they are read.
 */
export function classifyAgentRunError(
  error: string | null | undefined,
): AgentRunErrorClassification {
  const text = error?.trim() ?? "";
  const isCode = /^[A-Za-z][A-Za-z0-9_]*$/u.test(text);
  const errorCode = isCode ? text : UNKNOWN_ERROR_CODE;
  const errorClass = isCode ? classifyAgentRunErrorCode(text) : "unknown";
  return {
    errorClass,
    errorCode,
    errorMessage: isKnownMessage(errorCode)
      ? AGENT_ERROR_MESSAGES[errorCode]
      : CLASS_MESSAGES[errorClass],
    errorHint: CLASS_HINTS[errorClass],
  };
}

/** The hint of a class, for the failure overview. */
export function agentRunErrorHint(errorClass: AgentRunErrorClass): string {
  return CLASS_HINTS[errorClass];
}
