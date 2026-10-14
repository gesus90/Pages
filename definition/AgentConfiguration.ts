import type {
  AgentProfileTarget,
  AgentProfileTargetKind,
} from "./AgentProfile";
import type { AgentParameter } from "./AgentParameters";

/**
 * How a runner may work and the duration limit of one invocation.
 *
 * @remarks
 * Every runner works without asking anyone. Each runner maps these options to
 * its own verified switches; a combination a runner cannot enforce blocks the
 * node before its process starts.
 */
export interface AgentRunOptions {
  /** Whether the session may change files in its workspace. */
  readonly access: "workspace_write" | "read_only";
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
