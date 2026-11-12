import { ChatError } from "@/backend/error/ChatErrors";
import {
  acpRunOptions,
  agentRunOptionsFor,
} from "@/definition/AgentConfiguration";
import { hasChatAdapter } from "@/definition/AgentModelConsumers";

import type { McpServer } from "@agentclientprotocol/sdk";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { ChatAdapterProviderId } from "@/definition/AgentModelConsumers";

/**
 * The CLI runners Pica answers with over ACP, including native OpenCode (PAGE-91)
 * and Antigravity.
 *
 * @remarks
 * A provider registers its chat adapter once in `AGENT_PROVIDERS`; the runner
 * table below then has to name it, or the build fails.
 */
export type PicaAcpProvider = ChatAdapterProviderId;

/** What differs between the runners of Pica's ACP path. */
export interface PicaAcpRunner {
  readonly provider: PicaAcpProvider;
  /** The profile a stored agent session carries; a session of another profile is not continued. */
  readonly profile: string;
  /** Whether the cost the adapter reports is its own estimate rather than a billed amount. */
  readonly isCostEstimated: boolean;
  /** OpenCode reports only the last model step of a tool loop, never its complete turn. */
  readonly hasPartialTokenUsage?: boolean;
  /** Whether the adapter's cost includes the whole native session, across jobs. */
  readonly isCostSessionTotal?: boolean;
  /**
   * Whether the session reaches Pica's tools as its one MCP server, with a
   * credential of the job that admits calls only during a running turn.
   */
  readonly hasBridgeMcp?: boolean;
  /**
   * The MCP servers configured on the host that a session of an agent
   * employee on "Arbeitsplatz" or YOLO receives beside the Pages tools (PAGE-303).
   */
  readonly hostMcpServers?: readonly McpServer[];
  /** The session of an agent employee on YOLO runs without the bubblewrap isolation (PAGE-303). */
  readonly isUnisolated?: boolean;
  /**
   * The run options of a job, taken from the assignment.
   *
   * @throws {ChatError} `acpPermissionModeUnsupported` for a mode the runner
   * does not run Pica in.
   */
  readonly runOptions: (agent: ResolvedAgentAssignment) => AgentRunOptions;
}

/**
 * Codex keeps its PAGE-68 behaviour: the chat profile in every stored mode and
 * no deadline of its own beside the one of the chat.
 */
const CODEX_RUNNER: PicaAcpRunner = {
  provider: "codex_cli",
  profile: "pica-chat-1",
  isCostEstimated: false,
  runOptions: () => acpRunOptions("read_only", 0),
};

/**
 * Claude Code takes mode and duration limit from the assigned agent. Pica gets
 * nothing but the bridge tools there, which is "Nur Lesen"; an agent stored
 * with YOLO or the earlier write mode is refused, never narrowed silently.
 * Claude Code computes its cost from token counts and list prices, so the
 * amount is an estimate and, with a subscription sign-in, not billed.
 */
const CLAUDE_RUNNER: PicaAcpRunner = {
  provider: "claude_code",
  profile: "pica-claude-chat-1",
  isCostEstimated: true,
  runOptions: (agent) => {
    const run = agentRunOptionsFor(agent.connection.provider, agent.run);
    if (run.access !== "read_only")
      throw new ChatError("acpPermissionModeUnsupported");
    return run;
  },
};

/** OpenCode's native ACP session shares the chat lifecycle and never exposes built-in tools. */
const OPENCODE_RUNNER: PicaAcpRunner = {
  provider: "opencode",
  profile: "pica-opencode-chat-1",
  isCostEstimated: true,
  hasPartialTokenUsage: true,
  isCostSessionTotal: true,
  runOptions: (agent) => {
    const run = agentRunOptionsFor(agent.connection.provider, agent.run);
    if (run.access !== "read_only")
      throw new ChatError("acpPermissionModeUnsupported");
    return run;
  },
};

/**
 * Antigravity runs without any native tool; Pica's tools reach it as the one
 * MCP server of the session. Like Claude Code and OpenCode it answers only in
 * "Nur Lesen", and an agent stored with YOLO is refused, never narrowed.
 */
const ANTIGRAVITY_RUNNER: PicaAcpRunner = {
  provider: "antigravity",
  profile: "pica-antigravity-chat-1",
  isCostEstimated: false,
  hasBridgeMcp: true,
  runOptions: (agent) => {
    const run = agentRunOptionsFor(agent.connection.provider, agent.run);
    if (run.access !== "read_only")
      throw new ChatError("acpPermissionModeUnsupported");
    return run;
  },
};

const RUNNERS: Readonly<Record<PicaAcpProvider, PicaAcpRunner>> = {
  codex_cli: CODEX_RUNNER,
  claude_code: CLAUDE_RUNNER,
  opencode: OPENCODE_RUNNER,
  antigravity: ANTIGRAVITY_RUNNER,
};

/**
 * The MCP servers of a new chat session: Pica's bridge where the runner
 * reaches the Pages tools over it, then the servers configured on the host
 * for an agent employee with host tools (PAGE-303).
 *
 * @param runner - The runner of the job.
 * @param bridge - Issues the bridge server with a fresh credential of the job.
 * @returns The servers, or nothing when there are none, so the session keeps
 * the servers of its launch.
 */
export function chatMcpServers(
  runner: PicaAcpRunner,
  bridge: () => readonly McpServer[],
): { readonly mcpServers?: readonly McpServer[] } {
  const servers = [
    ...(runner.hasBridgeMcp === true ? bridge() : []),
    ...(runner.hostMcpServers ?? []),
  ];
  return servers.length > 0 ? { mcpServers: servers } : {};
}

/** Whether Pica answers with an agent of this provider over ACP. */
export function isPicaAcpProvider(
  provider: AgentProviderId,
): provider is PicaAcpProvider {
  return hasChatAdapter(provider);
}

/**
 * The runner of an agent assigned to the chat.
 *
 * @param agent - The assignment resolved for the message.
 * @returns What Pica's ACP path does differently for its provider.
 * @throws {ChatError} `acpProviderUnsupported` for any other provider; there is
 * no fallback to another runner.
 */
export function picaAcpRunner(agent: ResolvedAgentAssignment): PicaAcpRunner {
  const { provider } = agent.connection;
  if (!isPicaAcpProvider(provider))
    throw new ChatError("acpProviderUnsupported");
  return RUNNERS[provider];
}
