import type { AgentSessionTokenUsage } from "./AgentSessionJournal";

/** Why a mathematical estimate cannot be calculated from reported usage. */
export type AgentPriceGap =
  "model" | "tokens" | "cache_semantics" | "price" | "attempt";

/** A reference price for captured usage, never an invoice or subscription charge. */
export interface AgentSessionEstimate {
  readonly amountUsd: number | null;
  readonly modelId: string | null;
  readonly priceAsOf: string | null;
  readonly gap: AgentPriceGap | null;
}

/** Antigravity's captured tokens and their mathematical OpenRouter value. */
export interface AntigravityUsageTotal extends AgentSessionTokenUsage {
  readonly turns: number;
  /** ACP Usage has no separate reasoning count; it is never inferred from text. */
  readonly reasoningTokens: null;
  readonly amountUsd: number | null;
  readonly priceAsOf: readonly string[];
  readonly gaps: readonly AgentPriceGap[];
}
