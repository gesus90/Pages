/** Stable codes cross the HTTP boundary; upstream error text never does. */
export const AGENT_ERROR_MESSAGES = {
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

/** An administrator must also be operating in admin mode. */
export class AgentAccessDeniedError extends Error {
  public constructor() {
    super("Administrator mode is required to manage agent connections.");
    this.name = "AgentAccessDeniedError";
  }
}
