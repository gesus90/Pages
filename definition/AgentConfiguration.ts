import type { AgentProviderId } from "./AgentConnection";
import type {
  AgentProfileTarget,
  AgentProfileTargetKind,
} from "./AgentProfile";
import type { AgentParameter } from "./AgentParameters";

/**
 * How a session may reach its workspace.
 *
 * @remarks
 * `yolo` is the full access of an agent that runs over ACP, a Codex CLI or a
 * Claude Code agent, and exists for no other runner. `workspace_write` is the
 * earlier write mode; an ACP agent no longer runs with it until one of its two
 * modes is chosen.
 */
export type AgentRunAccess = "workspace_write" | "read_only" | "yolo";

/**
 * How a runner may work and the duration limit of one invocation.
 *
 * @remarks
 * Every runner works without asking anyone. Each runner maps these options to
 * its own verified switches; a combination a runner cannot enforce blocks the
 * node before its process starts. For an ACP agent the mode alone decides
 * shell and web, see {@link agentRunOptionsFor}.
 */
export interface AgentRunOptions {
  /** Whether the session may change files in its workspace. */
  readonly access: AgentRunAccess;
  /** Whether the session may run commands in its workspace. */
  readonly shell: boolean;
  /** Whether the session may search or fetch from the web. */
  readonly web: boolean;
  /** Hard duration limit in minutes; zero allows the session to finish without a deadline. */
  readonly timeoutMinutes: number;
}

/** Limits of {@link AgentRunOptions.timeoutMinutes}. */
export const AGENT_RUN_TIMEOUT_MINUTES = { minimum: 0, maximum: 120 } as const;

/** Options of an agent that names none: write in the workspace, no commands, no web, no deadline. */
export const DEFAULT_AGENT_RUN_OPTIONS: AgentRunOptions = {
  access: "workspace_write",
  shell: false,
  web: false,
  timeoutMinutes: 0,
};

/** The runners whose plan nodes run as Agent Client Protocol (ACP) sessions. */
export const ACP_PROVIDERS = ["codex_cli", "claude_code"] as const;
export type AcpProviderId = (typeof ACP_PROVIDERS)[number];

/** Native ACP drivers; OpenCode uses ACP for Pica while its plan runner stays separate. */
export type NativeAcpProviderId = AcpProviderId | "opencode";

/** Whether an agent of this provider runs as an ACP session in one of the two modes. */
export function isAcpProvider(
  provider: AgentProviderId,
): provider is AcpProviderId {
  return provider === "codex_cli" || provider === "claude_code";
}

/** The only two modes an ACP agent runs in: "Nur Lesen" and "YOLO". */
export const ACP_PERMISSION_MODES = ["read_only", "yolo"] as const;
export type AcpPermissionMode = (typeof ACP_PERMISSION_MODES)[number];

/** Narrows a stored access to one of the two ACP modes. */
export function isAcpPermissionMode(
  access: unknown,
): access is AcpPermissionMode {
  return access === "read_only" || access === "yolo";
}

/**
 * The run options of an ACP agent in one mode.
 *
 * @param mode - "Nur Lesen" or "YOLO".
 * @param timeoutMinutes - The duration limit, which stays separate from the mode.
 * @returns Options whose shell and web follow from the mode alone.
 *
 * @remarks
 * "Nur Lesen" never runs commands, so a command cannot bypass the missing
 * write access; reading web search stays available. YOLO allows everything the
 * runner supports.
 */
export function acpRunOptions(
  mode: AcpPermissionMode,
  timeoutMinutes: number,
): AgentRunOptions {
  return { access: mode, shell: mode === "yolo", web: true, timeoutMinutes };
}

/** Options of an ACP agent that names none: read only, no deadline. */
export const DEFAULT_ACP_RUN_OPTIONS: AgentRunOptions = acpRunOptions(
  "read_only",
  0,
);

/** The run options of a new agent of this provider. */
export function defaultAgentRunOptions(
  provider: AgentProviderId,
): AgentRunOptions {
  return isAcpProvider(provider)
    ? DEFAULT_ACP_RUN_OPTIONS
    : DEFAULT_AGENT_RUN_OPTIONS;
}

/**
 * The run options a runner applies to an agent.
 *
 * @param provider - The provider of the agent's model connection.
 * @param run - The stored run options, absent when the agent names none.
 * @returns The stored options for every runner but the ACP ones. An ACP agent
 * without options reads only, and its two modes are reduced to what they
 * allow; an earlier `workspace_write` stays as it is and blocks the start
 * until a mode is chosen.
 */
export function agentRunOptionsFor(
  provider: AgentProviderId,
  run: AgentRunOptions | undefined,
): AgentRunOptions {
  if (run === undefined) return defaultAgentRunOptions(provider);
  if (!isAcpProvider(provider) || !isAcpPermissionMode(run.access)) return run;
  return acpRunOptions(run.access, run.timeoutMinutes);
}

/**
 * Whether run options may be stored for an agent of this provider.
 *
 * @param provider - The provider of the agent's model connection.
 * @param run - The run options to store.
 * @param previous - The run options stored so far; absent for a new agent.
 * @returns `false` for YOLO outside the ACP runners, and for an ACP agent that
 * would store the earlier write mode anew instead of keeping it unchanged.
 *
 * @remarks
 * An agent saved before the two modes existed keeps its options until someone
 * chooses a mode, so an unrelated change does not fail; it never becomes YOLO
 * on its own.
 */
export function isAgentRunOptionsAllowed(
  provider: AgentProviderId,
  run: AgentRunOptions | undefined,
  previous: AgentRunOptions | undefined,
): boolean {
  if (!isAcpProvider(provider)) return run?.access !== "yolo";
  if (run === undefined || isAcpPermissionMode(run.access)) return true;
  return JSON.stringify(run) === JSON.stringify(previous);
}

/** Optional task configuration belongs to the same agent as its model access. */
export interface AgentConfiguration {
  readonly scope: AgentProfileTargetKind;
  readonly tag: string;
  readonly markdown: string;
  readonly projectId: string | null;
  readonly accessMode: "personal" | "shared";
  readonly parameters: readonly AgentParameter[];
  /** A prompt path has no runner side effect; this explicitly names its future directory binding. */
  readonly directoryParameter: string | null;
  /** Usage grants do not grant access to a connection or a project. */
  readonly sharing: {
    readonly isGlobal: boolean;
    readonly targets: readonly AgentProfileTarget[];
    readonly operator?: "and" | "or";
  };
  /** How CLI runners may work; absent means {@link DEFAULT_AGENT_RUN_OPTIONS}. */
  readonly run?: AgentRunOptions;
}

/** Creates an empty task section without granting usage or assigning a system function. */
export function emptyAgentConfiguration(
  scope: AgentProfileTargetKind = "person",
): AgentConfiguration {
  return {
    scope,
    tag: "",
    markdown: "",
    projectId: null,
    accessMode: scope === "person" ? "personal" : "shared",
    parameters: [],
    directoryParameter: null,
    sharing: { isGlobal: false, targets: [] },
    run: DEFAULT_AGENT_RUN_OPTIONS,
  };
}
