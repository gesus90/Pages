import { ACP_USAGE_CAPABILITIES } from "./AgentSessionUsageCapabilities";

import type { AgentSessionTokenUsage } from "./AgentSessionJournal";
import type { RunnerTerminal } from "./RunnerTerminal";

/** Uses the shared provider cache/partial semantics for a runner's cumulative single-turn reading. */
export function runnerTurnTokens(
  provider: "codex_cli" | "claude_code" | "opencode" | "antigravity",
  usage: RunnerTerminal["usage"],
): AgentSessionTokenUsage | null {
  if (Object.values(usage).every((reading) => reading == null)) return null;
  const capability = ACP_USAGE_CAPABILITIES[provider];
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    inputIncludesCache:
      provider === "codex_cli" ? true : capability.inputIncludesCache,
    isPartial:
      capability.isPartial ||
      usage.inputTokens === null ||
      usage.outputTokens === null,
  };
}
