import type { AgentUsage } from "@/definition/AgentUsage";

/** Stable codes cross the HTTP boundary; upstream error text never does. */
export const AGENT_ERROR_MESSAGES = {
  agent_tool_not_ready:
    "A required agent tool is not ready. The run events name the tool and cause; an administrator can inspect Settings → Agents → Tools.",
  opencode_acceptance_failed:
    "The OpenCode node did not prove every todo and acceptance criterion in its closing pages-report. Open or unproven work blocks successors even when ACP completed its turn.",
  opencode_permission_mode_required:
    "OpenCode agents run only in “Read only” or “YOLO”. Choose one of these modes; legacy workspace-write settings do not start.",
  opencode_chat_mode_required:
    "Pica's native OpenCode session requires read-only access with only the Pages tool bridge.",
  opencode_configuration_unmanaged:
    "OpenCode configuration or instructions outside Pages could change this session. Remove them from the connection's config folder or /etc/opencode.",
  opencode_acp_unsupported:
    "Pages requires the verified native OpenCode ACP contract of version 1.18.34. No model was called.",
  opencode_acp_session_failed:
    "The native OpenCode ACP session failed before or during its turn.",
  plan_json_invalid: "Enter one valid JSON value with finite numbers.",
  plan_number_invalid: "Enter one finite number.",
  plan_run_unavailable: "This run is no longer active. Start a new run.",
  plan_continuation_deleted: "Continuation point deleted – restart required.",
  plan_completed_changed:
    "This change requires completed work to run again. Stop and start a new run.",
  plan_pause_required:
    "Pause the run and wait until all steps have drained before editing.",
  plan_invalid: "Check the plan fields and graph nodes.",
  plan_script_invalid:
    "Check the script: name, interpreter profile, content, unique input and output names and a timeout of 1 to 86400 seconds.",
  plan_script_profile_missing:
    "The script's interpreter profile is not configured on this server. Choose a configured profile.",
  plan_script_interpreter_unavailable:
    "The configured interpreter is unavailable or not executable. Check this exact profile on the server.",
  plan_script_permission_denied:
    "Direct scripts require active administrator mode and current plan, project and approved workspace access.",
  plan_script_platform_unsupported:
    "Script execution requires Linux process ownership and cleanup support.",
  plan_script_input_required:
    "A required script input has no text value. Check its declared binding.",
  plan_script_input_limit:
    "The script input JSON exceeds the 1 MiB UTF-8 limit.",
  plan_script_spawn:
    "The configured interpreter could not be started. No replacement was used.",
  plan_script_exit:
    "The script exited with an error. See its exit code and stderr in the run details.",
  plan_script_signal: "The script ended through a signal. See the run details.",
  plan_script_timeout:
    "The configured timeout elapsed. See the owned process cleanup status.",
  plan_script_cancelled:
    "The script was stopped. See its process cleanup status.",
  plan_script_output_limit:
    "stdout or stderr exceeded 128 KiB. The step failed; no truncated success result is forwarded.",
  plan_script_encoding:
    "The script emitted invalid UTF-8. No replacement text is forwarded.",
  plan_script_credentials:
    "stdout contains credential-shaped text. The result was withheld; the step failed.",
  plan_script_io:
    "The script input/output or durable attempt recording failed.",
  plan_script_cleanup:
    "Process or temporary-resource cleanup could not be confirmed. The workspace remains reserved.",
  plan_script_interrupted:
    "The backend lost this process attempt. Side effects are uncertain; it is never replayed automatically.",
  plan_script_unavailable:
    "This script configuration or container is not supported by the runtime.",
  template_name_required: "Enter a name for the template.",
  template_name_taken:
    "You already have a template with this name. Choose another name.",
  template_not_found: "The template no longer exists.",
  template_invalid: "This node cannot be saved as a template.",
  plan_access_denied: "This plan or run is not accessible.",
  plan_conflict: "The plan changed. Reload it before saving or starting.",
  plan_name_taken: "This plan name is already taken. Choose another name.",
  plan_project_owner_only:
    "Only the owner moves a plan to another project. Choose a workspace of the plan's project.",
  plan_running:
    "A run of this plan is still active. Stop it before deleting the plan.",
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
  plan_run_option_unsupported:
    "The runner cannot enforce the run options of this agent, such as read-only access with commands. Change the run options.",
  plan_mcp_unavailable:
    "The node needs the Pages MCP adapter for agent sessions, but this server has none.",
  codex_permission_mode_required:
    "Codex CLI agents run only in “Read only” or “YOLO”. Choose one of the two modes for this agent.",
  claude_permission_mode_required:
    "Claude Code agents run only in “Read only” or “YOLO”. Choose one of the two modes for this agent.",
  plan_acp_adapter_missing:
    "Codex ACP is not ready. Check the managed installation and diagnostics under Settings → Agents → Tools.",
  plan_claude_acp_adapter_missing:
    "The Claude ACP adapter (claude-agent-acp) is not installed for the server account. Install it next to the Claude CLI with npm install -g @agentclientprotocol/claude-agent-acp@0.90.0 (see the README, ACP adapters) and start the node again.",
  plan_acp_adapter_unsupported:
    "The installed Codex ACP adapter is not a version Pages verified or does not offer what this run needs. Install a supported version of codex-acp (2.1.1 up to 3.0.0); the run record names the installed one.",
  plan_claude_acp_adapter_unsupported:
    "The installed Claude ACP adapter is not a version Pages verified or does not offer what this run needs. Install a supported version of claude-agent-acp (0.90.x); the run record names the installed one.",
  plan_model_unavailable:
    "The catalog of the runner does not offer the agent's model; nothing was sent, and the run never switches to another model.",
  plan_reasoning_unsupported:
    "The runner does not offer the agent's reasoning effort for this model; nothing was sent.",
  plan_permission_mode_unenforceable:
    "The ACP adapter does not offer or confirm the permission mode of the agent, so it cannot be enforced; nothing was sent. For Claude Code, a managed or workspace Claude setting that disables bypassPermissions, or a server account running as root, causes this. The run record names what the adapter reported.",
  plan_yolo_isolation_unavailable:
    "YOLO runs without an approval step of the runner, so it starts only inside the bubblewrap isolation, which does not work for the server account. Install bubblewrap (apt install bubblewrap), allow unprivileged user namespaces for the account, and start the node again; Pages probes the isolation again within a minute.",
  plan_codex_configuration_unmanaged:
    "A Codex configuration file (config.toml) outside Pages could change this run. Remove it from the connection folder or the workspace.",
  plan_acp_session_failed:
    "The Codex ACP session failed before or during its turn.",
  acp_session_resume_failed:
    "The ACP adapter could not continue the earlier session of this conversation.",
  plan_claude_acp_session_failed:
    "The Claude ACP session failed before or during its turn.",
  plan_definition_changed:
    "The AGENT.md of the agent is missing or does not match the started revision.",
  plan_placeholder_unresolved:
    "The prompt still contains a parameter placeholder; nothing was sent.",
  run_notes_unsupported:
    "Shared run notes have been removed. {{@run.notes}} is no longer supported; update this agent or plan node explicitly.",
  plan_runner_failed: "The runner ended its turn with an error.",
  plan_runner_incomplete: "The runner ended without completing its turn.",
  plan_runner_permission_denied:
    "The runner refused actions that the run options do not allow; nothing was approved on its behalf.",
  plan_acceptance_failed:
    "Historical run: the closing report did not prove every todo and acceptance criterion. This stored failure is unchanged; start a new run to use diagnostic-only progress.",
  plan_group_acceptance_failed:
    "The group agent did not pass acceptance. Its closing report must prove every todo and criterion; later agents and successors remain blocked.",
  plan_group_session_unsupported:
    "This adapter cannot continue a group's shared ACP session with a new step instruction. Use Codex or Claude Code agents over ACP.",
  plan_group_session_lost:
    "The group's shared ACP session is unavailable after its adapter process ended. Pages does not continue this group session in a new process; deliberately start a new run.",
  plan_loop_invalid:
    "Check the loop: its name, members, connections, number of iterations, session setting and end condition.",
  plan_loop_nested:
    "A loop holds only agents and scripts. Loops inside loops and groups inside loops are not supported; keep the subgraph flat.",
  plan_loop_runs_invalid:
    "The number of iterations must be a whole number from 1 to 999. Pages does not round, cut or replace it.",
  plan_loop_runs_unavailable:
    "The parameter that sets the number of iterations is missing, not readable or not a number. The loop did not start.",
  plan_loop_condition_source:
    "The end condition names a source node that is not an agent or script of this loop.",
  plan_loop_condition_path:
    "The JSON path of the end condition is not valid. Use a path such as $.end or $.review.end.",
  plan_loop_output_missing:
    "The source of the end condition returned no JSON. Return one JSON value or exactly one pages-loop-result block.",
  plan_loop_output_invalid:
    "The block with the result of the end condition is not valid JSON.",
  plan_loop_output_ambiguous:
    "The source of the end condition returned more than one pages-loop-result block. Return exactly one.",
  plan_loop_condition_field:
    "The JSON result has no field at the path of the end condition.",
  plan_loop_condition_type:
    "The value at the path of the end condition has another type than the expected value. Pages never converts types.",
  plan_loop_session_lost:
    "The retained ACP session of a loop agent is unavailable after its adapter process ended. Pages does not open a new session under the same identity; deliberately start a new run.",
  plan_session_unavailable:
    "This agent session has no open native session that could take another instruction. Its history stays readable.",
  plan_closeout_failed:
    "The session could not be closed completely; processes of it remained.",
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
  workspace_path_denied:
    "The server account may not open this directory. Choose another one.",
  workspace_path_contains_instance:
    "It holds Pages instance data, such as the database or agent files. Open a subfolder instead.",
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
  parameter_number_invalid:
    "Supply a valid finite number for every number parameter.",
  parameter_ticket_unavailable:
    "The selected ticket is unavailable or not accessible. Select an accessible ticket.",
  parameter_asset_unavailable:
    "A ticket asset is missing, deleted, unreadable or not accessible to the executing user. No incomplete input was sent.",
  parameter_asset_type_unsupported:
    "Ticket assets support PNG images and UTF-8 text files. A selected file has an unsupported format.",
  parameter_asset_transfer_unsupported:
    "This runner or handoff cannot deliver ticket assets. Use an API agent or an ACP adapter with image support, and bind the ticket to each receiving agent.",
  parameter_asset_reference_unsupported:
    "A referenced image or text file is not a Pages asset. Upload it to Pages and reference its attachment address.",
  parameter_assets_too_large:
    "Ticket assets exceed the 10 MiB transmission limit. No files were truncated or omitted.",
  parameter_ticket_changed:
    "The ticket asset references changed before transmission. Start the run again to use the current assets.",
  parameter_required: "Supply every required parameter.",
  parameter_reference_unavailable:
    "The parameter reference is unavailable or not accessible.",
  profile_in_use:
    "Remove the agent's assignments and usage grants before deleting it.",
  profile_conflict: "The agent changed. Reload it before saving.",
  profile_running:
    "The agent is part of a running plan. Change it after the run ended.",
  profile_limit_reached: "At most 100 agents per person can be created.",
  profile_scope_invalid: "Choose targets within the agent's scope.",
  personal_access_missing: "No matching personal model access is assigned.",
  personal_access_selection_required:
    "Choose a matching personal access explicitly.",
  agent_usage_denied: "The agent is not shared for this user and project.",
  agent_inactive: "The agent is inactive.",
  model_assignment_missing:
    "The assigned model was removed. Assign an available model to use this agent again.",
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
  cli_isolation_unavailable:
    "CLI agents need an isolated environment, which this server cannot provide.",
  acp_worker_unit_unavailable:
    "Pica's agents start only in a limited service unit, which the service manager of the server account does not provide. No model was called.",
  acp_worker_limit:
    "The agent process exceeded its memory or process limit and was ended inside its own unit. Other runs and services were not affected.",
  acp_output_overflow:
    "The agent process wrote an output line longer than 4 Mi characters and was ended. Its output was not used.",
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
