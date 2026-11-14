import type { CodexPrice, CodexTokenCounts } from "@/definition/CodexPlanUsage";

/** Highest durable counters prevent stale totals and replayed threads from being billed again. */
export function codexHighWater(
  before: CodexTokenCounts,
  after: CodexTokenCounts,
): CodexTokenCounts {
  function highest(field: keyof CodexTokenCounts): number | null {
    const current = after[field];
    return current === null
      ? before[field]
      : Math.max(before[field] ?? 0, current);
  }
  return {
    inputTokens: highest("inputTokens"),
    cacheReadTokens: highest("cacheReadTokens"),
    outputTokens: highest("outputTokens"),
    reasoningTokens: highest("reasoningTokens"),
  };
}

/** Only growth of the native cumulative thread counts belongs to the receiving step. */
export function codexTokenDelta(
  before: CodexTokenCounts,
  after: CodexTokenCounts,
): CodexTokenCounts {
  function delta(field: keyof CodexTokenCounts): number | null {
    const current = after[field];
    return current === null
      ? null
      : Math.max(0, current - (before[field] ?? 0));
  }
  return {
    inputTokens: delta("inputTokens"),
    cacheReadTokens: delta("cacheReadTokens"),
    outputTokens: delta("outputTokens"),
    reasoningTokens: delta("reasoningTokens"),
  };
}

/** Cache and reasoning are subsets, so neither is charged twice. Missing breakdowns use the base rate. */
export function codexTokenCost(
  tokens: CodexTokenCounts,
  price: CodexPrice | null,
): number | null {
  if (!price || tokens.inputTokens === null || tokens.outputTokens === null)
    return null;
  const cached = Math.min(tokens.inputTokens, tokens.cacheReadTokens ?? 0);
  const reasoning = Math.min(tokens.outputTokens, tokens.reasoningTokens ?? 0);
  return (
    (tokens.inputTokens - cached) * price.prompt +
    cached * price.cache +
    (tokens.outputTokens - reasoning) * price.completion +
    reasoning * price.reasoning
  );
}
