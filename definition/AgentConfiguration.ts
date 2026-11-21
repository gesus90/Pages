import { AGENT_ACCESS_MODES, storedAgentAccessMode } from "./AgentAccessMode";

import type { AgentAccessMode } from "./AgentAccessMode";
import type { AgentProviderId } from "./AgentConnection";
import type {
  AgentProfileTarget,
  AgentProfileTargetKind,
} from "./AgentProfile";
import type { AgentParameter } from "./AgentParameters";

/**
 * How a session may work, as it is stored.
 * @remarks
 * `read_only` ("Lesend") and `yolo` ("YOLO") are the two modes of
 * {@link AGENT_ACCESS_MODES}, with the same meaning for plan nodes, swarms
 * and agent employees. `workspace_write` is an earlier write mode: it stays
 * readable, never runs and never becomes YOLO on its own. An explicitly
 * stored `full_environment` is read as `yolo`, see {@link agentRunOptionsFor};
 * it is no mode of its own any more.
 */
export type AgentRunAccess =
  "workspace_write" | "read_only" | "yolo" | "full_environment";

/**
 * How a runner may work and the duration limit of one invocation.
 * @remarks
 * Every runner works without asking anyone. Each runner maps these options to
 * its own verified switches; a combination a runner cannot enforce blocks the
 * node before its process starts. For an ACP agent the mode alone decides
 * shell, web and browser, see {@link agentRunOptionsFor}.
 */
export interface AgentRunOptions {
  /** The mode of the session. */
  readonly access: AgentRunAccess;
  /** Whether the session may run commands; follows from the mode. */
  readonly shell: boolean;
  /** Whether the session may search or fetch from the web. */
  readonly web: boolean;
  /** Hard duration limit in minutes; zero allows the session to finish without a deadline. */
  readonly timeoutMinutes: number;
  /**
   * Whether Pages provides its administrator-enabled Playwright MCP to a YOLO
   * session; it adds a server and never narrows the native tools. "Lesend"
   * never gets it, because its actions cannot be proven to only read.
   */
  readonly browser?: boolean;
  /** Codex-only calendar-month equivalent USD budget; absent is unlimited. */
  readonly monthlyCostLimitUsd?: number;
}

/** Limits of {@link AgentRunOptions.timeoutMinutes}. */
export const AGENT_RUN_TIMEOUT_MINUTES = { minimum: 0, maximum: 120 } as const;

/** Options of an agent that names none: "Lesend", no commands, no web, no deadline. */
export const DEFAULT_AGENT_RUN_OPTIONS: AgentRunOptions = {
  access: "read_only",
  shell: false,
  web: false,
  timeoutMinutes: 0,
};

/** The runners whose plan nodes run as Agent Client Protocol (ACP) sessions. */
export const ACP_PROVIDERS = [
  "codex_cli",
  "claude_code",
  "opencode",
  "antigravity",
  "openrouter",
] as const;
export type AcpProviderId = (typeof ACP_PROVIDERS)[number];

/** Native ACP drivers shared by plans and Pica. */
export type NativeAcpProviderId = Exclude<AcpProviderId, "openrouter">;

/** Whether an agent of this provider runs as an ACP session in one of the two modes. */
export function isAcpProvider(
  provider: AgentProviderId,
): provider is AcpProviderId {
  return (
    provider === "codex_cli" ||
    provider === "claude_code" ||
    provider === "opencode" ||
    provider === "antigravity" ||
    provider === "openrouter"
  );
}

/** The only two modes an ACP agent runs in: "Lesend" and "YOLO". */
export const ACP_PERMISSION_MODES = AGENT_ACCESS_MODES;
export type AcpPermissionMode = AgentAccessMode;

/** Narrows a stored access to one of the two ACP modes. */
export function isAcpPermissionMode(
  access: unknown,
): access is AcpPermissionMode {
  return access === "read_only" || access === "yolo";
}

/**
 * The run options of an ACP agent in one mode.
 * @param mode - "Lesend" or "YOLO".
 * @param timeoutMinutes - The duration limit, which stays separate from the mode.
 * @returns Options whose shell and web follow from the mode alone.
 * @remarks
 * "Lesend" never runs commands, so a command cannot bypass the missing
 * write access; reading web search stays available. YOLO allows everything the
 * runner supports; no further switch narrows it.
 */
export function acpRunOptions(
  mode: AcpPermissionMode,
  timeoutMinutes: number,
): AgentRunOptions {
  return {
    access: mode,
    shell: mode === "yolo",
    web: true,
    timeoutMinutes,
  };
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
 * @param provider - The provider of the agent's model connection.
 * @param run - The stored run options, absent when the agent names none.
 * @returns The stored options for every runner but the ACP ones. An ACP agent
 * without options reads only, an explicitly stored `full_environment` runs as
 * YOLO, and both modes are reduced to what they allow; an earlier
 * `workspace_write` stays as it is and blocks the start until a mode is
 * chosen.
 */
export function agentRunOptionsFor(
  provider: AgentProviderId,
  run: AgentRunOptions | undefined,
): AgentRunOptions {
  if (run === undefined) return defaultAgentRunOptions(provider);
  const mode = storedAgentAccessMode(run.access);
  if (!isAcpProvider(provider) || mode === null) return run;
  return {
    ...acpRunOptions(mode, run.timeoutMinutes),
    ...(mode === "yolo" && run.browser !== undefined
      ? { browser: run.browser }
      : {}),
    ...(provider === "codex_cli" && run.monthlyCostLimitUsd !== undefined
      ? { monthlyCostLimitUsd: run.monthlyCostLimitUsd }
      : {}),
  };
}

/**
 * The stored form of run options: an explicitly given `full_environment`
 * becomes `yolo`, every other value stays as it is.
 * @param run - Run options as they were sent, imported or copied.
 */
export function normalizedAgentRunOptions(
  run: AgentRunOptions,
): AgentRunOptions {
  return run.access === "full_environment" ? { ...run, access: "yolo" } : run;
}

/**
 * Whether run options may be stored for an agent of this provider.
 * @param provider - The provider of the agent's model connection.
 * @param run - The run options to store.
 * @param previous - The run options stored so far; absent for a new agent.
 * @returns `false` for YOLO outside the ACP runners, and for an ACP agent that
 * would store the earlier write mode anew instead of keeping it unchanged.
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
  if (
    run?.browser === true &&
    (!isAcpProvider(provider) || !isAgentWriteAccess(run.access))
  )
    return false;
  if (!isAcpProvider(provider))
    return run === undefined || !isAgentWriteAccess(run.access);
  if (run === undefined || storedAgentAccessMode(run.access) !== null)
    return true;
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

/** Whether a stored access runs in one of the two modes; `full_environment` counts as YOLO. */
export function isPlanPermissionMode(
  access: unknown,
): access is AcpPermissionMode | "full_environment" {
  return storedAgentAccessMode(access) !== null;
}

/** Whether a stored access grants every native tool on the host: YOLO, or an explicitly stored `full_environment`. */
export function isAgentWriteAccess(access: AgentRunAccess): boolean {
  return storedAgentAccessMode(access) === "yolo";
}

/** The installed runtime of a plan provider, without changing its public identity. */
export function nativeAcpProvider(
  provider: AgentProviderId,
): NativeAcpProviderId | null {
  if (provider === "openrouter") return "opencode";
  return isAcpProvider(provider) ? provider : null;
}
