import type { OpenCodeMessageUsage } from "@/backend/agents/cli/OpenCodeSessionUsage";
import type { OpenCodeMessagePrice } from "./OpenRouterPriceCatalog";
import type { OpenCodeUsageTotal } from "@/definition/AgentSessionJournal";

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

/** Adds each stored native message exactly once and marks missing reports. */
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
      (attemptId) => !messages.some((message) => message.attemptId === attemptId),
    ) ||
    messages.some((message) => fields.some((read) => read(message) === null));
  const isCostUnknown = messages.some((message) => message.price.amount === null);
  const costUsd =
    messages.length === 0 || isCostUnknown
      ? null
      : sum(messages, (message) => message.price.amount);
  return {
    messages: messages.length,
    inputTokens: counts[0] ?? null,
    outputTokens: counts[1] ?? null,
    reasoningTokens: counts[2] ?? null,
    cacheReadTokens: counts[3] ?? null,
    cacheWriteTokens: counts[4] ?? null,
    costUsd,
    costState:
      costUsd === null
        ? "unknown"
        : messages.every((message) => message.price.state === "free")
          ? "free"
          : "known",
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
