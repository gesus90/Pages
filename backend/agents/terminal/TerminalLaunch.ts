import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { CliHome } from "@/backend/agents/cli/CliContracts";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";

/** How a turn of a terminal CLI ended, as the CLI reported it. */
export interface TerminalTurnEnd {
  /** `interrupted` after an interruption; a person may still continue the turn. */
  readonly status: "completed" | "interrupted" | "failed";
  /** The last answer of the agent in this turn, unredacted. */
  readonly output: string;
  readonly errorCode?: AgentErrorCode | null;
}

/** Usage a CLI reported, as far as it reports it. */
export interface TerminalUsage {
  readonly model?: string | null;
  readonly reasoningEffort?: string | null;
  readonly contextUsed?: number | null;
  readonly contextLimit?: number | null;
  /** Tokens used since the last report; the session adds them up per turn. */
  readonly increment?: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly cacheReadTokens: number | null;
    readonly cacheWriteTokens: number | null;
    readonly totalTokens: number | null;
  };
}

/** What the monitor of a CLI reports to its session. */
export interface TerminalMonitorEvents {
  /** The native session of the CLI is known. */
  readonly identified: (sessionId: string) => void;
  /** A prompt reached the model: the plan prompt, a pasted step or what a person typed. */
  readonly turnStarted: () => void;
  readonly turnEnded: (end: TerminalTurnEnd) => void;
  readonly usage: (usage: TerminalUsage) => void;
  /** The CLI waits for an answer of a person, such as an approval; the node fails. */
  readonly question: (question: string) => void;
}

/** Watches what a CLI reports beside its screen: hooks, transcript or local interface. */
export interface TerminalMonitor {
  start(events: TerminalMonitorEvents): Promise<void>;
  /** Stops watching and removes the files it created. */
  close(): Promise<void>;
}

/** Keys a session writes, with a pause before them. */
export interface TerminalKeys {
  readonly data: string;
  readonly delayMs: number;
}

/** How a CLI starts in its terminal and how Pages follows it. */
export interface TerminalLaunch {
  readonly file: string;
  readonly arguments: readonly string[];
  /** The arguments as the run record shows them, without the prompt. */
  readonly displayArguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  /** Exact values of the launch the terminal output must never show. */
  readonly secrets: readonly string[];
  readonly monitor: TerminalMonitor;
  /** The keys that interrupt the current step of the agent. */
  readonly interrupt: readonly TerminalKeys[];
  /** Text on the screen that means the CLI waits for an approval. */
  readonly questionPattern: RegExp | null;
  /** How the CLI works without asking anyone, for the run record. */
  readonly unattended: string;
  /** The session ID Pages chose, where the CLI accepts one. */
  readonly sessionId: string | null;
}

/** What a launch is planned from. */
export interface TerminalLaunchInput {
  readonly input: AgentPlanSessionInput;
  readonly mode: AcpPermissionMode;
  /** The CLI executable of the connection. */
  readonly cliFile: string;
  /** The home the CLI runs with: the plan home of a Claude session, otherwise the connection's. */
  readonly home: CliHome;
  /** A private folder of this session for hook events and generated settings. */
  readonly sessionDirectory: string;
  /** The Pages MCP server of the node; `null` without MCP access. */
  readonly mcp: { readonly url: string; readonly token: string } | null;
  /** Variables the ACP driver of the provider plans, such as OpenCode's configuration. */
  readonly driverEnvironment: Readonly<Record<string, string>>;
  /** The provider configuration of the mode, such as Codex's settings. */
  readonly configuration: Readonly<Record<string, unknown>> | null;
  /** Tells the CLI to decide on its own and never wait for a person. */
  readonly instruction: string;
}

/** What every plan session in a terminal tells its agent beside the plan prompt. */
export const TERMINAL_UNATTENDED_INSTRUCTION =
  "You run unattended in a Pages plan. Nobody answers questions or approvals: decide every open point yourself, state the assumption in your report, and continue until the step is done. Report the result with the Pages tool report_step_result.";
