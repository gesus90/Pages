import type { AgentUsage } from "@/definition/AgentUsage";

/** Stable codes cross the HTTP boundary; upstream error text never does. */
export const AGENT_ERROR_MESSAGES = {
  plan_invalid: "Check the plan fields and graph nodes.",
  plan_access_denied: "This plan or run is not accessible.",
  plan_conflict: "The plan changed. Reload it before saving or starting.",
  plan_cycle: "Execution dependencies contain a cycle.",
  plan_binding_invalid: "Check parameter ports and source or result bindings.",
  plan_workspace_conflict:
    "Parallel steps or another run would write to the same working copy.",
  plan_context_changed:
    "The workspace, project or model context changed. Review the plan before starting again.",
  plan_directory_required:
    "CLI plan steps require an explicit workspace directory parameter.",
  plan_step_failed: "The step failed. Provider diagnostics are not exposed.",
  plan_dependency_failed:
    "A dependency failed or was cancelled; this step is blocked.",
  plan_interrupted:
    "The server interrupted this run. It cannot be resumed automatically.",
  workspace_invalid: "Enter a name, an existing local directory and a project.",
  workspace_project_unsupported:
    "The project needs a link to a GitHub repository.",
  workspace_management_denied:
    "Only administrators and those who manage the project can manage its workspaces.",
  workspace_access_denied: "The workspace or its project is not accessible.",
  workspace_not_found: "The workspace registration no longer exists.",
  workspace_conflict: "The workspace changed. Reload it before saving.",
  workspace_roots_missing:
    "Workspace roots have not been configured on the server.",
  workspace_path_invalid:
    "Choose an absolute path to an existing local directory.",
  workspace_path_unavailable:
    "The directory is unavailable or lacks read, write or traversal permission.",
  workspace_path_outside_roots:
    "The directory is outside approved roots or overlaps Pages instance data.",
  workspace_path_changed:
    "The registered directory was replaced or redirected. Register it again explicitly.",
  workspace_path_conflict:
    "Another workspace already registers this directory or an overlapping directory.",
  workspace_in_use:
    "Remove the workspace references before unregistering or rebinding it.",
  configuration_invalid: "Enter a valid agent configuration.",
  parameter_invalid: "Check parameter names, types and defaults.",
  parameter_required: "Supply every required parameter.",
  parameter_reference_unavailable:
    "The parameter reference is unavailable or not accessible.",
  profile_in_use:
    "Remove the agent's assignments and usage grants before deleting it.",
  profile_conflict: "The agent changed. Reload it before saving.",
  profile_running:
    "The agent is part of a running plan. Change it after the run ended.",
  profile_scope_invalid: "Choose targets within the agent's scope.",
  personal_access_missing: "No matching personal model access is assigned.",
  personal_access_selection_required:
    "Choose a matching personal access explicitly.",
  agent_usage_denied: "The agent is not shared for this user and project.",
  agent_inactive: "The agent is inactive.",
  system_function_in_use: "This system function already has an agent.",
  profile_invalid: "Enter a valid execution profile.",
  profile_not_found: "The execution profile no longer exists.",
  profile_target_invalid: "Choose an existing assignment target.",
  function_invalid: "Choose a predefined agent function.",
  assignment_exists:
    "This function already has an assignment. Edit it instead.",
  assignment_not_found: "The assignment no longer exists. Create it again.",
  connection_in_use:
    "Remove or change this connection's agent assignments before deleting it.",
  catalog_unsupported:
    "This provider has no documented token-free catalog endpoint.",
  catalog_interval_invalid: "Choose a supported catalog refresh interval.",
  catalog_limit_exceeded:
    "The catalog exceeded its safety limits; the previous catalog was retained.",
  name_required: "A connection needs a name.",
  name_too_long: "The name must not exceed 80 characters.",
  name_taken: "A connection already uses this name.",
  provider_invalid: "Choose a supported provider.",
  provider_immutable: "The provider cannot be changed.",
  api_key_required: "An API key is required.",
  api_key_invalid_format: "The API key has an invalid format.",
  test_model_invalid: "The model ID has an invalid format.",
  reasoning_effort_invalid: "The reasoning effort has an invalid format.",
  reasoning_effort_unsupported:
    "The model catalog does not list this reasoning effort for the selected model.",
  connection_limit_reached: "At most 50 connections can be stored.",
  connection_not_found: "The connection does not exist.",
  connection_scope_invalid:
    "Choose global use, or between 1 and 200 persons, groups or departments.",
  secret_unavailable:
    "The saved secret cannot be decrypted. Replace the API key.",
  check_in_progress: "An operation is already running for this connection.",
  check_timeout: "The check exceeded its time limit.",
  test_model_required: "Choose a model before running a model test.",
  provider_unreachable: "The provider could not be reached.",
  provider_auth_failed: "The provider rejected the API key.",
  provider_permission_denied: "The provider denied access.",
  provider_quota_exhausted: "The provider quota or balance is exhausted.",
  provider_rate_limited:
    "The provider rate limit was reached. Try again later.",
  provider_model_not_found: "The model is unavailable.",
  provider_request_rejected: "The provider rejected the test request.",
  provider_unavailable: "The provider is temporarily unavailable.",
  provider_bad_response: "The provider returned an unexpected response.",
  cli_not_found:
    "The CLI was not found. Check its installation and service PATH.",
  cli_not_executable: "The CLI cannot be executed.",
  cli_not_logged_in: "Sign in to the CLI account first.",
  cli_auth_failed: "The CLI account was rejected. Sign in again.",
  cli_check_failed: "The CLI test failed.",
  cli_unexpected_output: "The CLI returned unexpected output.",
  login_in_progress: "A login is already running for this connection.",
  login_limit_reached:
    "The CLI process or login limit was reached. Try again later.",
  login_not_running: "No matching login is running.",
  login_expired: "The login expired. Start again.",
  login_cancelled: "The login was cancelled.",
  login_failed: "The CLI login failed.",
  login_code_invalid: "Enter a valid login code.",
  login_code_rejected: "The CLI rejected the code. Start login again.",
  login_device_auth_unavailable:
    "Enable device authentication in the ChatGPT security settings.",
  credential_cleanup_failed:
    "The credential directory could not be removed. The connection was retained.",
} as const;

export type AgentErrorCode = keyof typeof AGENT_ERROR_MESSAGES;

/** Recognizes only errors Pages can safely translate. */
export function isAgentErrorCode(value: unknown): value is AgentErrorCode {
  return (
    typeof value === "string" && Object.hasOwn(AGENT_ERROR_MESSAGES, value)
  );
}

/** A safe, translatable failure with no upstream text or credential values. */
export class AgentError extends Error {
  public readonly code: AgentErrorCode;

  public constructor(code: AgentErrorCode) {
    super(AGENT_ERROR_MESSAGES[code]);
    this.name = "AgentError";
    this.code = code;
  }
}

/** A deletion lock that carries the current references, so the caller can list them. */
export class AgentInUseError extends AgentError {
  public readonly usages: readonly AgentUsage[];

  public constructor(
    code: "profile_in_use" | "connection_in_use",
    usages: readonly AgentUsage[],
  ) {
    super(code);
    this.usages = usages;
  }
}

/** An administrator must also be operating in admin mode. */
export class AgentAccessDeniedError extends Error {
  public constructor() {
    super("Administrator mode is required to manage agent connections.");
    this.name = "AgentAccessDeniedError";
  }
}
