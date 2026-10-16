import { approvePermission, refusePermission } from "./AcpPermissions";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type {
  AcpConfigStep,
  AcpModelRequest,
  AcpPermissionDecision,
  AcpSessionProfile,
  AcpSessionPurpose,
} from "./AcpDriver";

/** The session mode of the Codex ACP adapter that carries a Pages mode. */
export type CodexAcpSessionMode = "read-only" | "agent-full-access";

/**
 * How one Pages mode runs in the Codex ACP adapter.
 *
 * @remarks
 * The adapter applies approval policy and sandbox of its session mode to
 * every turn; codex-acp 2.1.1 to 2.x map `read-only` to approval `on-request`
 * with a read-only sandbox and `agent-full-access` to approval `never`
 * without a sandbox of its own. The configuration lies above every
 * configuration file of Codex, so a file cannot widen it.
 */
export interface CodexAcpProfile extends AcpSessionProfile {
  readonly sessionMode: CodexAcpSessionMode;
  /** Codex configuration the adapter applies to the session, passed as `CODEX_CONFIG`. */
  readonly configuration: Readonly<Record<string, unknown>>;
}

// Sign-in and provider stay those of the connection: no API key, no other provider.
const ACCOUNT_CONFIGURATION = {
  cli_auth_credentials_store: "file",
  forced_login_method: "chatgpt",
  model_provider: "openai",
} as const;

const REPORTED_OPTIONS = {
  sessionMode: "mode",
  model: "model",
  reasoningEffort: "reasoning_effort",
} as const;

/**
 * Answers a permission request of the adapter; nobody is asked during a run.
 *
 * @param mode - The mode of the agent.
 * @param request - The request of the adapter.
 * @returns The selected option and whether it refuses.
 *
 * @remarks
 * YOLO approves every request once, so nothing waits for a person and no
 * approval is stored for later runs. "Nur Lesen" refuses every command, file
 * change and additional permission. It only approves calls of MCP tools: the
 * Pages MCP server is the only one a session gets, and its credential allows
 * nothing but reading, so the server refuses every change itself.
 */
export function decideCodexPermission(
  mode: AcpPermissionMode,
  request: RequestPermissionRequest,
): AcpPermissionDecision {
  const isMcpToolCall = request._meta?.is_mcp_tool_approval === true;
  if (mode === "yolo" || isMcpToolCall) return approvePermission(request);
  return refusePermission(request);
}

// The mode first, then the model; the effort comes last because a model change resets it.
function codexSteps(
  sessionMode: CodexAcpSessionMode,
  request: AcpModelRequest,
): readonly AcpConfigStep[] {
  const steps: AcpConfigStep[] = [
    {
      id: REPORTED_OPTIONS.sessionMode,
      value: sessionMode,
      refusal: "plan_permission_mode_unenforceable",
    },
    {
      id: REPORTED_OPTIONS.model,
      value: request.model,
      refusal: "plan_model_unavailable",
    },
  ];
  if (request.reasoningEffort !== null)
    steps.push({
      id: REPORTED_OPTIONS.reasoningEffort,
      value: request.reasoningEffort,
      refusal: "plan_reasoning_unsupported",
    });
  return steps;
}

const READ_ONLY_PROFILE: CodexAcpProfile = {
  mode: "read_only",
  sessionMode: "read-only",
  configuration: {
    ...ACCOUNT_CONFIGURATION,
    web_search: "live",
    // Apps reach accounts outside Pages; a command could bypass the missing write access.
    features: {
      shell_tool: false,
      unified_exec: false,
      apps: false,
      plugins: false,
      multi_agent: false,
    },
  },
  unattended:
    "ACP session mode read-only (approval on-request, sandbox read-only); Pages refuses every request except calls of Pages MCP tools, which the server limits to reading",
  permissions: {
    permissionMode: "read_only",
    approvalPolicy: "on-request, answered by Pages",
    sandbox: "read-only",
    files: "read",
    shell: "off",
    web: "search",
    pagesMcp: "read",
  },
  reportedOptions: REPORTED_OPTIONS,
  matchesReportedModel: null,
  hasMcpStatusCommand: false,
  isContinuable: true,
  steps: (request) => codexSteps("read-only", request),
  decide: (request) => decideCodexPermission("read_only", request),
};

const YOLO_PROFILE: CodexAcpProfile = {
  mode: "yolo",
  sessionMode: "agent-full-access",
  configuration: {
    ...ACCOUNT_CONFIGURATION,
    web_search: "live",
    // The process already has Pages' allowlist. Keep GIT_CONFIG_KEY_* in shells without loading a user profile.
    shell_environment_policy: {
      inherit: "all",
      ignore_default_excludes: true,
      experimental_use_profile: false,
    },
    // Apps reach accounts outside Pages, which YOLO does not grant.
    features: { shell_tool: true, unified_exec: true, apps: false },
  },
  unattended:
    "ACP session mode agent-full-access (approval never, no Codex sandbox) inside the bubblewrap isolation; Pages approves any remaining request",
  permissions: {
    permissionMode: "yolo",
    approvalPolicy: "never",
    sandbox: "danger-full-access inside bubblewrap",
    files: "read, create, change, delete in the workspace",
    shell: "on",
    web: "search",
    pagesMcp: "every tool of the executor",
  },
  reportedOptions: REPORTED_OPTIONS,
  matchesReportedModel: null,
  hasMcpStatusCommand: false,
  isContinuable: true,
  steps: (request) => codexSteps("agent-full-access", request),
  decide: (request) => decideCodexPermission("yolo", request),
};

/**
 * Pica's conversation: no command, file, image, code or app tool and no web
 * search, only the tools of the Pica bridge, which Pages checks on every call.
 */
const CHAT_PROFILE: CodexAcpProfile = {
  mode: "read_only",
  sessionMode: "read-only",
  configuration: {
    ...ACCOUNT_CONFIGURATION,
    web_search: "disabled",
    features: {
      shell_tool: false,
      unified_exec: false,
      view_image: false,
      js_repl: false,
      code_mode: false,
      apps: false,
      plugins: false,
      multi_agent: false,
    },
  },
  unattended:
    "ACP session mode read-only for Pica; Pages refuses every request except calls of the Pica tool bridge",
  permissions: {
    permissionMode: "read_only",
    approvalPolicy: "on-request, answered by Pages",
    sandbox: "read-only",
    files: "none",
    shell: "off",
    web: "off",
    pagesMcp: "Pica tool bridge",
  },
  reportedOptions: REPORTED_OPTIONS,
  matchesReportedModel: null,
  hasMcpStatusCommand: false,
  isContinuable: true,
  steps: (request) => codexSteps("read-only", request),
  decide: (request) => decideCodexPermission("read_only", request),
};

/**
 * The adapter configuration of one Pages mode.
 *
 * @param mode - "Nur Lesen" or "YOLO", as the agent stores it.
 * @param purpose - A Pica conversation always takes the chat profile.
 * @returns Session mode, configuration and the recorded permissions.
 */
export function codexAcpProfile(
  mode: AcpPermissionMode,
  purpose: AcpSessionPurpose = "plan",
): CodexAcpProfile {
  if (purpose === "chat") return CHAT_PROFILE;
  return mode === "yolo" ? YOLO_PROFILE : READ_ONLY_PROFILE;
}
