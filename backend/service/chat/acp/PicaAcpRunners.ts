import { ChatError } from "@/backend/error/ChatErrors";
import {
  acpRunOptions,
  agentRunOptionsFor,
} from "@/definition/AgentConfiguration";

import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { AgentProviderId } from "@/definition/AgentConnection";

/** The CLI runners Pica answers with over ACP: Codex (PAGE-68) and Claude Code (PAGE-90). */
export type PicaAcpProvider = "codex_cli" | "claude_code";

/** What differs between the runners of Pica's ACP path. */
export interface PicaAcpRunner {
  readonly provider: PicaAcpProvider;
  /** The profile a stored agent session carries; a session of another profile is not continued. */
  readonly profile: string;
  /** Whether the cost the adapter reports is its own estimate rather than a billed amount. */
  readonly isCostEstimated: boolean;
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

/** Whether Pica answers with an agent of this provider over ACP. */
export function isPicaAcpProvider(
  provider: AgentProviderId,
): provider is PicaAcpProvider {
  return provider === "codex_cli" || provider === "claude_code";
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
  return provider === "codex_cli" ? CODEX_RUNNER : CLAUDE_RUNNER;
}
