import { isZaiCodingPlanModel } from "@/definition/AgentConnection";

import type { OpenCodeMessageUsage } from "@/backend/agents/cli/OpenCodeSessionUsage";
import type { OpenCodeMessagePrice } from "./OpenRouterPriceCatalog";
import type { OpenCodeUsageTotal } from "@/definition/AgentSessionJournal";
import type {
  AgentCostSource,
  AgentPriceGap,
  AgentSessionUsageEstimate,
} from "@/definition/AgentSessionPricing";

/** The source of an amount by the state its message was priced with. */
const COST_SOURCES: Readonly<
  Record<OpenCodeMessagePrice["state"], AgentCostSource | null>
> = {
  free: "free",
  catalog: "catalog",
  native: "provider",
  unknown: null,
};

/** A native message attributed once to the attempt that first observed it. */
export interface StoredOpenCodeUsage extends OpenCodeMessageUsage {
  readonly attemptId: string;
  readonly turn: number;
  readonly price: OpenCodeMessagePrice;
  readonly reportedAt: string;
}

function sum(
  messages: readonly StoredOpenCodeUsage[],
  read: (message: StoredOpenCodeUsage) => number | null,
): number | null {
  const known = messages.flatMap((message) => {
    const count = read(message);
    return count === null ? [] : [count];
  });
  return known.length === 0
    ? null
    : known.reduce((total, count) => total + count, 0);
}

/**
 * The amount a message adds to an estimate; `null` when it has none.
 * @remarks
 * OpenCode also calculates 0 for a model it knows no price of, so a provider
 * amount of 0 is an amount only for a model that is confirmed free.
 */
function messageAmount(message: StoredOpenCodeUsage): number | null {
  const { amount, state } = message.price;
  return state === "native" && amount === 0 ? null : amount;
}

function openCodeCostState(
  costUsd: number | null,
  messages: readonly StoredOpenCodeUsage[],
): OpenCodeUsageTotal["costState"] {
  if (costUsd === null) return "unknown";
  return messages.every((message) => message.price.state === "free")
    ? "free"
    : "known";
}

/**
 * Adds each stored native message exactly once and marks missing reports.
 * @param messages - The native messages of the attempts to sum.
 * @param expectedAttempts - Attempts that must have reported a message.
 * @returns The sums; the cost is `null` as soon as one message has no amount,
 * also for a reported cost of 0 of a model that is not confirmed free, as
 * every step of a subscription reports it.
 */
export function sumOpenCodeUsage(
  messages: readonly StoredOpenCodeUsage[],
  expectedAttempts: ReadonlySet<string> = new Set(),
): OpenCodeUsageTotal {
  const fields = [
    (message: StoredOpenCodeUsage): number | null => message.inputTokens,
    (message: StoredOpenCodeUsage): number | null => message.outputTokens,
    (message: StoredOpenCodeUsage): number | null => message.reasoningTokens,
    (message: StoredOpenCodeUsage): number | null => message.cacheReadTokens,
    (message: StoredOpenCodeUsage): number | null => message.cacheWriteTokens,
  ];
  const counts = fields.map((read) => sum(messages, read));
  const isIncomplete =
    messages.length === 0 ||
    [...expectedAttempts].some(
      (attemptId) =>
        !messages.some((message) => message.attemptId === attemptId),
    ) ||
    messages.some((message) => fields.some((read) => read(message) === null));
  const isCostUnknown = messages.some(
    (message) => messageAmount(message) === null,
  );
  const costUsd =
    messages.length === 0 || isCostUnknown
      ? null
      : sum(messages, messageAmount);
  return {
    messages: messages.length,
    inputTokens: counts[0] ?? null,
    outputTokens: counts[1] ?? null,
    reasoningTokens: counts[2] ?? null,
    cacheReadTokens: counts[3] ?? null,
    cacheWriteTokens: counts[4] ?? null,
    costUsd,
    costState: openCodeCostState(costUsd, messages),
    isIncomplete,
    priceAsOf: [
      ...new Set(
        messages.flatMap((message) =>
          message.price.priceAsOf ? [message.price.priceAsOf] : [],
        ),
      ),
    ],
  };
}

/**
 * Whether its provider names a model free: OpenCode Zen ends the name with
 * `-free`, OpenRouter with `:free`.
 * @param model - A native OpenCode model as `provider/model`; `null` when a
 * message names none.
 * @returns `true` only for such a name, so a cost of 0 is a confirmed zero
 * for it and no missing price.
 */
export function isNamedFreeModel(model: string | null): boolean {
  if (model === null) return false;
  return (
    (model.startsWith("opencode/") && model.endsWith("-free")) ||
    (model.startsWith("openrouter/") && model.endsWith(":free"))
  );
}

/**
 * Whether a native OpenCode model runs on a subscription instead of a price
 * per token: the Z.AI Coding Plan, `zai-coding-plan/…`.
 * @param model - A native OpenCode model as `provider/model`; `null` when a
 * message names none.
 * @returns `true` only for a model of the subscription's own native provider.
 * @remarks
 * OpenCode's model list states a price of 0 for such a model because the
 * subscription pays for it, so every step reports a cost of 0. That zero is
 * neither the amount of a free model nor a missing price of the standard
 * API: the usage counts against the quota of the subscription, which Pages
 * reads for the connection and never turns into an amount.
 */
export function isSubscriptionModel(model: string | null): boolean {
  return model !== null && isZaiCodingPlanModel(model);
}

/**
 * Prices a native message from what OpenCode itself reported for it.
 * @param message - The usage of one model step, as a runner read it.
 * @returns The cost OpenCode calculated as the provider amount; a cost of 0
 * for a model its provider names free as a confirmed zero; no amount without
 * a reported cost.
 * @remarks
 * A runner host has no price list of Pages, so nothing is calculated here.
 */
export function nativeOpenCodePrice(
  message: OpenCodeMessageUsage,
): OpenCodeMessagePrice {
  if (message.costUsd === null)
    return { amount: null, state: "unknown", priceAsOf: null };
  if (message.costUsd === 0 && isNamedFreeModel(message.model))
    return { amount: 0, state: "free", priceAsOf: null };
  return { amount: message.costUsd, state: "native", priceAsOf: null };
}

/**
 * Why the messages of an attempt carry no amount; empty when every message
 * has one.
 * @remarks
 * A step of a subscription without an amount names `subscription` instead of
 * a missing price, so the hint never reads as an unknown price of the model.
 */
function messagePriceGaps(
  messages: readonly StoredOpenCodeUsage[],
): readonly AgentPriceGap[] {
  if (messages.length === 0) return ["attempt"];
  const gaps = new Set<AgentPriceGap>();
  for (const message of messages) {
    if (message.inputTokens === null || message.outputTokens === null)
      gaps.add("tokens");
    else if (messageAmount(message) === null)
      gaps.add(isSubscriptionModel(message.model) ? "subscription" : "price");
  }
  return [...gaps];
}

/** The one source of the amounts, or `mixed` for several. */
function amountSourceOf(
  messages: readonly StoredOpenCodeUsage[],
): AgentCostSource | undefined {
  const sources = new Set(
    messages.flatMap((message) => {
      const source = COST_SOURCES[message.price.state];
      return source === null ? [] : [source];
    }),
  );
  const [first] = sources;
  return sources.size > 1 ? "mixed" : first;
}

/**
 * The tokens the model steps of one OpenCode attempt processed and their
 * amount, for the block "Verbrauch" of the plan terminal.
 * @param messages - Native messages of any attempt; only those of `attemptId` count.
 * @param attemptId - The selected attempt; another attempt never adds to it.
 * @param isRunning - Whether a turn of the attempt still runs.
 * @returns The sums of the attempt's model steps with the amounts stored with them.
 * @remarks
 * Every model step of the session and its sub-sessions is one native message,
 * stored once under its own identity, so a repeated reading and the end of a
 * turn never count twice. OpenCode counts the input without the cache reads
 * and the output without the reasoning; the output of the estimate contains
 * the reasoning, which is billed as output. A step that has reported nothing
 * yet is no message, so its counts stay open instead of 0. While a turn runs
 * the amount covers the finished steps only and is marked as partial. A step
 * of a subscription reports its counts like any other and a cost of 0, which
 * is no amount: the attempt keeps its counts and names the gap `subscription`.
 */
export function openCodeAttemptUsage(
  messages: readonly StoredOpenCodeUsage[],
  attemptId: string,
  isRunning: boolean,
): AgentSessionUsageEstimate {
  const own = messages.filter((message) => message.attemptId === attemptId);
  const inputTokens = sum(own, (message) => message.inputTokens);
  const reasoningTokens = sum(own, (message) => message.reasoningTokens);
  const answered = sum(own, (message) => message.outputTokens);
  const outputTokens =
    answered === null ? null : answered + (reasoningTokens ?? 0);
  const cacheReadTokens = sum(own, (message) => message.cacheReadTokens);
  const cacheWriteTokens = sum(own, (message) => message.cacheWriteTokens);
  const gaps = messagePriceGaps(own);
  const amountUsd = gaps.length > 0 ? null : sum(own, messageAmount);
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens:
      inputTokens === null || outputTokens === null
        ? null
        : inputTokens +
          outputTokens +
          (cacheReadTokens ?? 0) +
          (cacheWriteTokens ?? 0),
    inputIncludesCache: false,
    isPartial: isRunning || gaps.length > 0,
    turns: new Set(own.map((message) => message.turn)).size,
    amountUsd,
    isAmountPartial: amountUsd !== null && isRunning,
    ...(amountUsd === null ? {} : { amountSource: amountSourceOf(own) }),
    priceAsOf: [
      ...new Set(
        own.flatMap((message) =>
          message.price.priceAsOf ? [message.price.priceAsOf] : [],
        ),
      ),
    ],
    priceModels: [
      ...new Set(
        own.flatMap((message) => (message.model ? [message.model] : [])),
      ),
    ],
    gaps,
  };
}
