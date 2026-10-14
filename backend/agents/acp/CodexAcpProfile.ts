import type {
  PermissionOptionKind,
  RequestPermissionOutcome,
  RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import type { CodexPermissionMode } from "@/definition/AgentConfiguration";

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
export interface CodexAcpProfile {
  readonly mode: CodexPermissionMode;
  readonly sessionMode: CodexAcpSessionMode;
  /** Codex configuration the adapter applies to the session, passed as `CODEX_CONFIG`. */
  readonly configuration: Readonly<Record<string, unknown>>;
  /** How the session works without anybody approving, as the run records it. */
  readonly unattended: string;
  /** What the session may do, as the run records it. */
  readonly permissions: Readonly<Record<string, string>>;
}

/** What Pages answers a permission request of the adapter. */
export interface CodexPermissionDecision {
  readonly outcome: RequestPermissionOutcome;
  /** The request was refused; the run counts it as a permission denial. */
  readonly isDenied: boolean;
}

// Sign-in and provider stay those of the connection: no API key, no other provider.
const ACCOUNT_CONFIGURATION = {
  cli_auth_credentials_store: "file",
  forced_login_method: "chatgpt",
  model_provider: "openai",
} as const;

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
};

const YOLO_PROFILE: CodexAcpProfile = {
  mode: "yolo",
  sessionMode: "agent-full-access",
  configuration: {
    ...ACCOUNT_CONFIGURATION,
    web_search: "live",
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
};

/**
 * The adapter configuration of one Pages mode.
 *
 * @param mode - "Nur Lesen" or "YOLO", as the agent stores it.
 * @returns Session mode, configuration and the recorded permissions.
 */
export function codexAcpProfile(mode: CodexPermissionMode): CodexAcpProfile {
  return mode === "yolo" ? YOLO_PROFILE : READ_ONLY_PROFILE;
}

function optionOf(
  request: RequestPermissionRequest,
  kinds: readonly PermissionOptionKind[],
): RequestPermissionOutcome {
  for (const kind of kinds) {
    const option = request.options.find((entry) => entry.kind === kind);
    if (option) return { outcome: "selected", optionId: option.optionId };
  }
  return { outcome: "cancelled" };
}

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
  mode: CodexPermissionMode,
  request: RequestPermissionRequest,
): CodexPermissionDecision {
  const isMcpToolCall = request._meta?.is_mcp_tool_approval === true;
  if (mode === "yolo" || isMcpToolCall)
    return {
      outcome: optionOf(request, ["allow_once", "allow_always"]),
      isDenied: false,
    };
  return {
    outcome: optionOf(request, ["reject_once", "reject_always"]),
    isDenied: true,
  };
}
