/** Fixed identifiers accepted by the instance tool manager. */
export const AGENT_TOOL_IDS = [
  "node",
  "bubblewrap",
  "codex",
  "claude",
  "opencode",
  "codex_acp",
  "claude_acp",
  "antigravity_acp",
  "pages_mcp",
  "playwright_mcp",
  "chromium",
  "firefox",
] as const;
export type AgentToolId = (typeof AGENT_TOOL_IDS)[number];
export type AgentToolKind =
  "runtime" | "sandbox" | "agent" | "acp" | "mcp" | "browser";
export type AgentToolStatus =
  | "ready"
  | "installing"
  | "updating"
  | "repairing"
  | "authentication_required"
  | "missing_dependency"
  | "unsupported"
  | "failed";
export type AgentToolDiagnostic =
  | "not_checked"
  | "ready"
  | "not_installed"
  | "version_unsupported"
  | "execution_failed"
  | "handshake_failed"
  | "browser_failed"
  | "browser_sandbox_unavailable"
  | "sandbox_unavailable"
  | "permission_denied"
  | "installation_failed"
  | "active_sessions"
  | "removed"
  | "settings_unavailable"
  | "authentication_required"
  | "dependency_failed"
  | "disabled"
  | "workspace_unavailable"
  | "root_not_allowed"
  | "rollback_failed"
  | "browser_permission_required";
export type AgentToolAction =
  "install" | "update" | "repair" | "check" | "test" | "remove" | "rollback";

/** Secret-free native activity, separate from installation and health. */
export interface AgentToolActivity {
  readonly instanceId: string;
  readonly processId: number | null;
  readonly sessionId: string | null;
}

/** Cached operator view; reading this object never executes a program. */
export interface AgentToolView {
  readonly id: AgentToolId;
  readonly name: string;
  readonly kind: AgentToolKind;
  readonly enabled: boolean;
  readonly status: AgentToolStatus;
  readonly diagnostic: AgentToolDiagnostic;
  readonly dependency: AgentToolId | null;
  readonly installedVersion: string | null;
  readonly supportedVersions: readonly string[];
  readonly approvedVersion: string | null;
  readonly updateAvailable: boolean;
  readonly source: "managed" | "system" | "bundled" | null;
  readonly installed: boolean | null;
  readonly lastCheck: string | null;
  readonly activities: readonly AgentToolActivity[];
  readonly authentication: readonly {
    readonly connectionId: string;
    readonly isReady: boolean;
  }[];
}

/** Validates an external identifier without accepting commands or package names. */
export function isAgentToolId(input: unknown): input is AgentToolId {
  return typeof input === "string" && AGENT_TOOL_IDS.some((id) => id === input);
}

/** Only these maintenance operations can reach the fixed registry. */
export function isAgentToolAction(input: unknown): input is AgentToolAction {
  return [
    "install",
    "update",
    "repair",
    "check",
    "test",
    "remove",
    "rollback",
  ].some((action) => action === input);
}
