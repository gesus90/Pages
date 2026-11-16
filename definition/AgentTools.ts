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
  | "browser_permission_required"
  | "update_not_checked"
  | "release_incompatible"
  | "release_unavailable"
  | "adapter_incompatible";
export type AgentToolAction =
  | "install"
  | "update"
  | "repair"
  | "check"
  | "test"
  | "remove"
  | "rollback"
  | "rebind";

/** The page-wide action that reads release metadata of every fixed source. */
export const AGENT_TOOL_CHECK_UPDATES = "check_updates";

/**
 * What "Updates suchen" found for one tool.
 * @remarks
 * A failed or unreachable source never reads as `current`; a system
 * installation is `external` because Pages does not change it.
 */
export type AgentToolUpdateState =
  | "not_checked"
  | "current"
  | "update_available"
  | "check_failed"
  | "source_unreachable"
  | "external"
  | "incompatible";

/** Release metadata of one tool, read only on an explicit update search. */
export interface AgentToolReleaseView {
  readonly state: AgentToolUpdateState;
  /** The newest stable release the official source publishes. */
  readonly latestVersion: string | null;
  /** The release an update installs; it can be older than `latestVersion` to stay compatible. */
  readonly targetVersion: string | null;
  /** The official source, as a host and package or repository name. */
  readonly source: string | null;
  readonly checkedAt: string | null;
}

/** Steps of one update, rollback or re-binding, in the order they run. */
export type AgentToolPhase =
  | "resolving"
  | "installing_cli"
  | "verifying_cli"
  | "installing_adapter"
  | "verifying_adapter"
  | "activating"
  | "rolling_back"
  | "rebinding";

/** The last maintenance operation of a tool; it survives until the next one starts. */
export interface AgentToolOperationView {
  readonly action: AgentToolAction;
  readonly state: "running" | "succeeded" | "failed";
  readonly phase: AgentToolPhase;
  readonly diagnostic: AgentToolDiagnostic | null;
  /** The action that repeats the failed step from the actual installed state. */
  readonly retryAction: AgentToolAction | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

/** A connection's state after re-binding; account data and secrets never appear here. */
export interface AgentToolConnectionView {
  readonly connectionId: string;
  readonly name: string;
  readonly status: "ready" | "login_required" | "failed";
  readonly errorCode: string | null;
  readonly checkedAt: string;
  readonly modelCount: number;
  readonly catalogRefreshedAt: string | null;
  /** The listing failed or came back empty; the models shown are the last valid ones. */
  readonly isCatalogStale: boolean;
  readonly catalogErrorCode: string | null;
  /** The saved model, when the new catalog no longer offers it. */
  readonly missingModel: string | null;
  /** The saved reasoning level, when the saved model no longer offers it. */
  readonly missingReasoningEffort: string | null;
}

/** Secret-free native activity, separate from installation and health. */
export interface AgentToolActivity {
  readonly instanceId: string;
  readonly processId: number | null;
  readonly sessionId: string | null;
}

/** The operator's terminal starts the same file as new Pages calls only while `isCurrent` holds. */
export interface AgentToolTerminalEntry {
  readonly path: string;
  readonly isCurrent: boolean;
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
  /** The version of the generation new sessions start; running ones keep theirs. */
  readonly activeVersion: string | null;
  readonly supportedVersions: readonly string[];
  readonly approvedVersion: string | null;
  readonly updateAvailable: boolean;
  readonly release: AgentToolReleaseView;
  /** The adapter of a CLI, or the CLI of an adapter; never the same version. */
  readonly pairedTool: AgentToolId | null;
  /** The CLI serves ACP itself, as `agy acp` and OpenCode do. */
  readonly hasIntegratedAdapter: boolean;
  readonly operation: AgentToolOperationView | null;
  readonly connections: readonly AgentToolConnectionView[];
  /** Time of the last check that found the tool ready. */
  readonly lastSuccessfulCheck: string | null;
  readonly source: "managed" | "system" | "bundled" | null;
  /** File that new Pages calls start; a running session keeps the generation it pinned. */
  readonly executable?: string | null;
  /** Retained managed generation that an explicit rollback checks and activates. */
  readonly rollbackRelease?: string | null;
  /** Stable link for the operator's terminal of a tool that publishes one. */
  readonly terminalEntry?: AgentToolTerminalEntry | null;
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
    "rebind",
  ].some((action) => action === input);
}
