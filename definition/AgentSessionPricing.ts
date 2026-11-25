import type { AgentSessionTokenUsage } from "./AgentSessionJournal";

/**
 * Why a mathematical estimate cannot be calculated from reported usage.
 * @remarks
 * `subscription` names usage a subscription covers, such as a step of the
 * Z.AI Coding Plan: the provider reports no amount for it, and the rates of
 * the standard API are no price of the subscription, so nothing is estimated.
 */
export type AgentPriceGap =
  "model" | "tokens" | "cache_semantics" | "price" | "attempt" | "subscription";

/** A reference price for captured usage, never an invoice or subscription charge. */
export interface AgentSessionEstimate {
  readonly amountUsd: number | null;
  /**
   * Whether the amount prices only the counts that were reported: a count
   * that is missing adds nothing and is never priced as 0.
   */
  readonly isPartial: boolean;
  readonly modelId: string | null;
  readonly priceAsOf: string | null;
  readonly gap: AgentPriceGap | null;
}

/**
 * Where the amount of an estimate comes from.
 * - `catalog`: calculated from the reported counts and a catalog price.
 * - `provider`: the amount the provider's own tool calculated and reported.
 * - `free`: a reported cost of 0 for a model that is confirmed free.
 * - `mixed`: amounts of several of these sources in one sum.
 */
export type AgentCostSource = "catalog" | "provider" | "free" | "mixed";

/**
 * The tokens a session captured and their mathematical OpenRouter value, as
 * the block "Verbrauch" of the plan terminal shows them.
 */
export interface AgentSessionUsageEstimate extends AgentSessionTokenUsage {
  readonly turns: number;
  /**
   * The estimate in US dollars over the reported counts; `null` unless every
   * turn reported a count, the cache counting is verified and the catalog
   * prices the model and each count it reported.
   */
  readonly amountUsd: number | null;
  /**
   * Whether the amount covers only part of the work: a turn lacks a count,
   * as the cache writes of a running prompt, was counted only in part, or
   * still runs and reported an interim reading. The amount of the finished
   * turn replaces it.
   */
  readonly isAmountPartial: boolean;
  /**
   * Where the amount comes from; absent for an estimate from catalog prices
   * alone and without an amount.
   */
  readonly amountSource?: AgentCostSource;
  readonly priceAsOf: readonly string[];
  /** The catalog entries the estimate priced, such as `google/gemini-4-hydrogen`. */
  readonly priceModels: readonly string[];
  readonly gaps: readonly AgentPriceGap[];
}

/** Antigravity's captured tokens and their mathematical OpenRouter value. */
export interface AntigravityUsageTotal extends AgentSessionUsageEstimate {
  /**
   * `agy acp` reports `thoughtTokens`, but whether its output count already
   * contains them is not verified, so no reasoning count is kept.
   */
  readonly reasoningTokens: null;
}

/** Antigravity usage of the selected attempt, its node and its run. */
export interface AntigravityUsageView {
  /** The session of the selected attempt alone; another attempt never adds to it. */
  readonly attempt: AntigravityUsageTotal;
  readonly step: AntigravityUsageTotal;
  readonly run: AntigravityUsageTotal;
}

/**
 * The euro reference rate of the US dollar the ECB published for one working
 * day.
 * @remarks
 * The ECB quotes how many US dollars one euro buys. Pages keeps the last
 * valid rate with its day, so on a weekend or after a failed read the
 * terminal converts with the rate of the latest working day and names it.
 */
export interface EuroDollarReferenceRate {
  /** US dollars for one euro, such as `1.0963`. */
  readonly usdPerEur: number;
  /** The ECB working day of the rate, `YYYY-MM-DD`. */
  readonly date: string;
}
