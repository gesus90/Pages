import { sumTurnUsage, withTurnUsage } from "./AgentSessionUsage";

import type { OpenRouterPriceCatalog } from "./OpenRouterPriceCatalog";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type {
  AgentPriceGap,
  AgentSessionEstimate,
  AntigravityUsageTotal,
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

function total(
  turns: readonly PricedTurn[],
  attempts: ReadonlySet<string>,
): AntigravityUsageTotal {
  const usages = turns.map((turn) => turn.usage);
  const tokens = sumTurnUsage(usages)[0];
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
  return {
    ...tokenTotals(tokens),
    isPartial: (tokens?.isPartial ?? true) || gaps.size > 0,
    turns: turns.length,
    reasoningTokens: null,
    amountUsd: totalAmount(turns, gaps),
    priceAsOf: [
      ...new Set(
        turns.flatMap((turn) =>
          turn.price.priceAsOf ? [turn.price.priceAsOf] : [],
        ),
      ),
    ],
    gaps: [...gaps],
  };
}

/**
 * Projects each ACP turn once into step and run totals, across loop attempts.
 * Catalogue estimates concern captured work only; missing attempts invalidate the amount.
 */
export async function antigravityUsage(input: {
  readonly turns: readonly AgentSessionTurnUsage[];
  readonly stepAttempts: ReadonlySet<string>;
  readonly runAttempts: ReadonlySet<string>;
  readonly confirmedModels?: ReadonlyMap<string, string>;
  readonly catalog?: Pick<OpenRouterPriceCatalog, "calculate">;
}): Promise<{
  readonly step: AntigravityUsageTotal;
  readonly run: AntigravityUsageTotal;
}> {
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
        modelId: null,
        priceAsOf: null,
        gap: "price",
      },
    })),
  );
  return {
    step: total(
      priced.filter((turn) => input.stepAttempts.has(turn.usage.attemptId)),
      input.stepAttempts,
    ),
    run: total(priced, input.runAttempts),
  };
}
