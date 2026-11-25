import { sumTurnUsage, withTurnUsage } from "./AgentSessionUsage";

import type { AntigravityPriceCatalog } from "./AntigravityPriceCatalog";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type {
  AgentPriceGap,
  AgentSessionEstimate,
  AntigravityUsageTotal,
  AntigravityUsageView,
} from "@/definition/AgentSessionPricing";

interface PricedTurn {
  readonly usage: AgentSessionTurnUsage;
  readonly price: AgentSessionEstimate;
}

function totalAmount(
  turns: readonly PricedTurn[],
  gaps: ReadonlySet<AgentPriceGap>,
): number | null {
  const amounts = turns.map((turn) => turn.price.amountUsd);
  return gaps.size || amounts.some((amount) => amount === null)
    ? null
    : amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
}

function tokenTotals(
  tokens: ReturnType<typeof sumTurnUsage>[number] | undefined,
): Pick<
  AntigravityUsageTotal,
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "totalTokens"
  | "inputIncludesCache"
> {
  return {
    inputTokens: tokens?.inputTokens ?? null,
    outputTokens: tokens?.outputTokens ?? null,
    cacheReadTokens: tokens?.cacheReadTokens ?? null,
    cacheWriteTokens: tokens?.cacheWriteTokens ?? null,
    totalTokens: tokens?.totalTokens ?? null,
    inputIncludesCache: tokens?.inputIncludesCache ?? null,
  };
}

/** The distinct non-empty values in order of first appearance. */
function distinct(values: readonly (string | null)[]): readonly string[] {
  return [...new Set(values.flatMap((value) => (value ? [value] : [])))];
}

/** Why the turns cannot carry an estimate; empty when every turn and attempt has a price. */
function priceGaps(
  turns: readonly PricedTurn[],
  attempts: ReadonlySet<string>,
): ReadonlySet<AgentPriceGap> {
  const usages = turns.map((turn) => turn.usage);
  const gaps = new Set<AgentPriceGap>(
    turns.flatMap((turn) => (turn.price.gap ? [turn.price.gap] : [])),
  );
  if (
    !turns.length ||
    [...attempts].some(
      (attemptId) => !usages.some((turn) => turn.attemptId === attemptId),
    )
  )
    gaps.add("attempt");
  return gaps;
}

/** Whether a turn's amount leaves out a count it lacks or work the adapter did not count. */
function isPartlyPriced(turn: PricedTurn): boolean {
  return turn.price.isPartial || turn.usage.isPartial;
}

function total(
  turns: readonly PricedTurn[],
  attempts: ReadonlySet<string>,
): AntigravityUsageTotal {
  const tokens = sumTurnUsage(turns.map((turn) => turn.usage))[0];
  const gaps = priceGaps(turns, attempts);
  const amountUsd = totalAmount(turns, gaps);
  return {
    ...tokenTotals(tokens),
    isPartial: (tokens?.isPartial ?? true) || gaps.size > 0,
    turns: turns.length,
    reasoningTokens: null,
    amountUsd,
    isAmountPartial: amountUsd !== null && turns.some(isPartlyPriced),
    priceAsOf: distinct(turns.map((turn) => turn.price.priceAsOf)),
    priceModels: distinct(turns.map((turn) => turn.price.modelId)),
    gaps: [...gaps],
  };
}

/**
 * Projects each ACP turn once into attempt, step and run totals, across loop attempts.
 * @remarks
 * Every turn counts once, however often its report was stored. Catalogue
 * estimates concern captured work only. A turn that lacks a count, such as
 * the cache writes of a running prompt, or that the adapter counted only in
 * part is priced with what it reported and marks the amount as partial; the
 * finished turn replaces it. A missing attempt, an unknown model or a count
 * without a price leaves no amount.
 */
export async function antigravityUsage(input: {
  readonly turns: readonly AgentSessionTurnUsage[];
  readonly attemptId: string;
  readonly stepAttempts: ReadonlySet<string>;
  readonly runAttempts: ReadonlySet<string>;
  readonly confirmedModels?: ReadonlyMap<string, string>;
  readonly catalog?: Pick<AntigravityPriceCatalog, "calculate">;
}): Promise<AntigravityUsageView> {
  const unique = input.turns
    .filter((turn) => turn.provider === "antigravity")
    .reduce<readonly AgentSessionTurnUsage[]>(
      (kept, turn) => withTurnUsage(kept, turn),
      [],
    );
  const priced = await Promise.all(
    unique.map(async (usage): Promise<PricedTurn> => ({
      usage,
      price: (await input.catalog?.calculate({
        ...usage,
        model:
          usage.model ?? input.confirmedModels?.get(usage.attemptId) ?? null,
      })) ?? {
        amountUsd: null,
        isPartial: false,
        modelId: null,
        priceAsOf: null,
        gap: "price",
      },
    })),
  );
  return {
    attempt: total(
      priced.filter((turn) => turn.usage.attemptId === input.attemptId),
      new Set([input.attemptId]),
    ),
    step: total(
      priced.filter((turn) => input.stepAttempts.has(turn.usage.attemptId)),
      input.stepAttempts,
    ),
    run: total(priced, input.runAttempts),
  };
}
