import type { Usage } from "@agentclientprotocol/sdk";
import type { TurnTokenDelta } from "../sessions/AgentSessionUsage";

function count(input: unknown): number | null {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : null;
}

/** Uses Codex's inclusive total to normalize ACP adapters that expose either cached or uncached input. */
export function codexPromptTokens(usage: Usage | null): TurnTokenDelta {
  const outputTokens = count(usage?.outputTokens);
  const totalTokens = count(usage?.totalTokens);
  const inputTokens =
    totalTokens !== null && outputTokens !== null && totalTokens >= outputTokens
      ? totalTokens - outputTokens
      : null;
  return {
    isReset: false,
    tokens: {
      inputTokens,
      outputTokens,
      cacheReadTokens: count(usage?.cachedReadTokens),
      cacheWriteTokens: count(usage?.cachedWriteTokens),
      reasoningTokens: count(usage?.thoughtTokens),
      totalTokens,
      inputIncludesCache: true,
      isPartial: inputTokens === null || outputTokens === null,
    },
  };
}
