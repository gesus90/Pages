import { canonicalClaudeModel } from "@/definition/ClaudePriceModels";
import { ClaudeUsageRepository } from "@/backend/database/repositories/agent/ClaudeUsageRepository";
import { OpenRouterPriceRepository } from "@/backend/database/repositories/agent/OpenRouterPriceRepository";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import {
  claudePriceSchema,
  addClaudeTokens,
  CLAUDE_TOKEN_FIELDS,
} from "@/definition/ClaudeUsage";

import {
  allocateClaudeTokens,
  applyClaudeObservation,
  ledgerTotals,
} from "./ClaudeUsageLedger";
import { findClaudePrice } from "./OpenRouterPrices";

import type { AgentSessionDatabase } from "@/backend/database/repositories/agent/AgentSessionDatabase";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type {
  ClaudeAccounting,
  ClaudeModelUsage,
  ClaudePrice,
  ClaudeTokens,
} from "@/definition/ClaudeUsage";

/** Computes the theoretical USD amount from the frozen rates, without charging a subscription. */
export function claudeModelCost(
  model: ClaudeModelUsage,
  price: ClaudePrice | null,
): number | null {
  if (!price || model.inputTokens === null || model.outputTokens === null)
    return null;
  const amount =
    model.inputTokens * Number(price.prompt) +
    model.outputTokens * Number(price.completion) +
    (model.cacheReadTokens ?? 0) * Number(price.cacheRead) +
    (model.cacheWriteTokens ?? 0) * Number(price.cacheWrite);
  return Number.isFinite(amount) ? amount : null;
}

function pricedUsage(
  usage: AgentSessionTurnUsage,
  models: readonly ClaudeModelUsage[],
  prices: readonly ClaudePrice[],
  options: {
    readonly previous: ClaudeAccounting | undefined;
    readonly overrides: Readonly<Record<string, string>>;
    readonly frozen: readonly ClaudeAccounting["models"][number][];
  },
): AgentSessionTurnUsage {
  const priced = models.map((model) => {
    const stored =
      options.previous?.models.find((entry) => entry.model === model.model) ??
      options.frozen.find((entry) => entry.model === model.model);
    return {
      ...model,
      price: stored
        ? stored.price
        : findClaudePrice(
            prices,
            model.model,
            Object.entries(options.overrides).find(
              ([key]) =>
                canonicalClaudeModel(key) === canonicalClaudeModel(model.model),
            )?.[1],
          ),
    };
  });
  const amounts = priced.map((entry) => claudeModelCost(entry, entry.price));
  const costUsd =
    amounts.length === 0 || amounts.some((amount) => amount === null)
      ? null
      : amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const tokens = priced.reduce<ClaudeTokens>(addClaudeTokens, {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  });
  const { claudeObservation, ...stored } = usage;
  return {
    ...stored,
    ...tokens,
    totalTokens: CLAUDE_TOKEN_FIELDS.every((field) => tokens[field] === null)
      ? null
      : CLAUDE_TOKEN_FIELDS.reduce(
          (sum, field) => sum + (tokens[field] ?? 0),
          0,
        ),
    isPartial:
      usage.claudeObservation?.kind === "prompt" ||
      priced.length === 0 ||
      priced.some((model) =>
        CLAUDE_TOKEN_FIELDS.some((field) => model[field] === null),
      ),
    claudeAccounting: {
      sessionId:
        claudeObservation?.sessionId ?? options.previous?.sessionId ?? "",
      subscription: true,
      models: priced,
      costUsd,
    },
  };
}

/** Applies a native observation once, allocates its increment and freezes the first price of each model. */
export async function accountClaudeUsage(
  database: AgentSessionDatabase,
  usage: AgentSessionTurnUsage,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const sessions = new AgentSessionRepository({
      ...transaction,
      transaction: async (work) => work(transaction),
    });
    const repository = new ClaudeUsageRepository(transaction);
    const observation = usage.claudeObservation;
    const sessionId = observation?.sessionId ?? `prompt:${usage.attemptId}`;
    const ledger = await repository.lock(sessionId);
    const previous = await sessions.findTurnUsage(usage.attemptId, usage.turn);
    if (!observation && previous?.claudeAccounting) return;
    const next = observation
      ? applyClaudeObservation(ledger, observation)
      : ledger;
    if (observation && next === ledger) return;
    const models = observation
      ? allocateClaudeTokens(
          ledgerTotals(ledger),
          ledgerTotals(next),
          previous?.claudeAccounting?.models ?? [],
        )
      : [
          {
            model: usage.model ?? "unknown",
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
          },
        ];
    const frozen = (await sessions.listAttemptUsage(usage.attemptId)).flatMap(
      (entry) => entry.claudeAccounting?.models ?? [],
    );
    const cache = await new OpenRouterPriceRepository(transaction).read();
    const prices = cache
      ? claudePriceSchema.array().parse(JSON.parse(cache.catalog))
      : [];
    const overrides = await repository.modelOverrides(usage.attemptId);
    await sessions.saveTurnUsage(
      pricedUsage(usage, models, prices, {
        previous: previous?.claudeAccounting,
        overrides,
        frozen,
      }),
    );
    if (observation) await repository.save(sessionId, next);
  });
}
