/** Fixed identifiers accepted by the instance tool manager. */
export const AGENT_TOOL_IDS = [
  "node",
  "python",
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
  | "adapter_incompatible"
  | "target_changed"
  | "update_running"
  | "update_interrupted"
  | "integrity_failed";
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

/** The form field that binds an update click to the target the page showed. */
export const AGENT_TOOL_UPDATE_TARGET_FIELD = "target";

/**
 * What an automatic or manual update search found for one tool.
 * @remarks
 * A failed or unreachable source never reads as `current`. While the installed
 * version is unknown (`version_unknown`) or the tool is confirmed missing
 * (`not_installed`), it never reads as `update_available`; a system
 * installation stays `external` because Pages does not modify it.
 */
export type AgentToolUpdateState =
  | "not_checked"
  | "version_unknown"
  | "not_installed"
  | "current"
  | "update_available"
  | "check_failed"
  | "source_unreachable"
  | "external"
  | "incompatible";

/** Release metadata of one tool from the last daily or manual update search. */
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
  | "installing_runtime"
  | "verifying_runtime"
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

/** One release an update installs, per tool of the changed combination. */
export interface AgentToolUpdateTargetVersion {
  readonly id: AgentToolId;
  /** `null` keeps the installed generation of this tool and checks it with its partner again. */
  readonly version: string | null;
}

/**
 * Whether and to which checked release "Aktualisieren" moves a tool.
 * @remarks
 * `target` is sent back with the click; the server starts the update only
 * while it still names the same checked releases of the whole combination.
 */
export interface AgentToolUpdateView {
  /** Pages can install its own generation of this tool from a fixed source. */
  readonly isSupported: boolean;
  /** New sessions use an installation outside Pages; an update installs a Pages generation next to it. */
  readonly isExternal: boolean;
  /** The checked combination target a click installs, or `null` when no update can start. */
  readonly target: string | null;
  /** The tool's own target is newer than the version new sessions use, also next to an external installation. */
  readonly isNewer: boolean;
  readonly targetVersions: readonly AgentToolUpdateTargetVersion[];
  /** Why no update can start now; `null` when one can or the tool is current. */
  readonly blocker: AgentToolDiagnostic | null;
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
  readonly update: AgentToolUpdateView;
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

/** Diagnostics a repeated check cannot change: the tool is missing or disabled, needs a sign-in or a permission, or its version is not supported. */
const LASTING_AGENT_TOOL_DIAGNOSTICS: ReadonlySet<string> =
  new Set<AgentToolDiagnostic>([
    "not_installed",
    "version_unsupported",
    "authentication_required",
    "permission_denied",
    "removed",
    "disabled",
    "settings_unavailable",
    "root_not_allowed",
    "browser_permission_required",
    "browser_sandbox_unavailable",
    "workspace_unavailable",
  ]);

/**
 * Whether a failed tool check may succeed when it is repeated shortly after,
 * such as a probe that could not start under load or did not answer in time.
 * @param diagnostic - The diagnostic of the failed check; an unknown one counts as transient.
 */
export function isTransientAgentToolFailure(diagnostic: string): boolean {
  return (
    diagnostic !== "ready" && !LASTING_AGENT_TOOL_DIAGNOSTICS.has(diagnostic)
  );
}
