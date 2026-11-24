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
  /**
   * `agy acp` reports `thoughtTokens`, but whether its output count already
   * contains them is not verified, so no reasoning count is kept.
   */
  readonly reasoningTokens: null;
  /**
   * The estimate in US dollars; `null` unless every turn reported all four
   * counts, the cache counting is verified and the catalog prices the model.
   */
  readonly amountUsd: number | null;
  readonly priceAsOf: readonly string[];
  /** The catalog entries the estimate priced, such as `google/gemini-4-hydrogen`. */
  readonly priceModels: readonly string[];
  readonly gaps: readonly AgentPriceGap[];
}

/** Antigravity usage of the selected attempt, its node and its run. */
export interface AntigravityUsageView {
  /** The session of the selected attempt alone; another attempt never adds to it. */
  readonly attempt: AntigravityUsageTotal;
  readonly step: AntigravityUsageTotal;
  readonly run: AntigravityUsageTotal;
}
