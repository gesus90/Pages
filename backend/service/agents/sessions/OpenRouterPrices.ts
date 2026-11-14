import { z } from "zod";

import { canonicalClaudeModel } from "@/definition/ClaudePriceModels";
import { logCaughtError } from "@/backend/logging/Logger";
import { claudePriceSchema } from "@/definition/ClaudeUsage";

import type { OpenRouterPriceRepository } from "@/backend/database/repositories/agent/OpenRouterPriceRepository";
import type { ClaudePrice } from "@/definition/ClaudeUsage";

const DAY_MS = 86_400_000;
const pricing = claudePriceSchema
  .pick({ prompt: true, completion: true })
  .extend({
    input_cache_read: z.string().optional(),
    input_cache_write: z.string().optional(),
  });
const catalogSchema = z.object({
  data: z.array(z.object({ id: z.string(), pricing: z.unknown() })),
});

/** Reads valid Anthropic prices; one malformed model cannot discard the rest of the cache. */
export function parseOpenRouterPrices(
  input: unknown,
  fetchedAt: string,
): readonly ClaudePrice[] {
  return catalogSchema.parse(input).data.flatMap((model) => {
    if (!model.id.startsWith("anthropic/")) return [];
    const parsed = pricing.safeParse(model.pricing);
    if (!parsed.success) return [];
    const rates = parsed.data;
    const price = claudePriceSchema.safeParse({
      modelId: model.id,
      fetchedAt,
      prompt: rates.prompt,
      completion: rates.completion,
      cacheRead: rates.input_cache_read ?? rates.prompt,
      cacheWrite: rates.input_cache_write ?? rates.prompt,
    });
    return price.success ? [price.data] : [];
  });
}

/** Resolves only a unique exact model/version; aliases and ambiguous variants require an administrator. */
export function findClaudePrice(
  prices: readonly ClaudePrice[],
  model: string,
  override?: string,
): ClaudePrice | null {
  if (override)
    return prices.find((price) => price.modelId === override) ?? null;
  const matches = prices.filter(
    (price) =>
      canonicalClaudeModel(price.modelId) === canonicalClaudeModel(model),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Refreshes the public catalog at startup and daily, preserving the successful disk cache on failure. */
export class OpenRouterPrices {
  private readonly repository: Pick<OpenRouterPriceRepository, "read" | "save">;
  private readonly request: typeof fetch;
  private readonly now: () => Date;
  private refreshing: Promise<void> | null = null;

  public constructor(
    repository: Pick<OpenRouterPriceRepository, "read" | "save">,
    request: typeof fetch = fetch,
    now: () => Date = () => new Date(),
  ) {
    this.repository = repository;
    this.request = request;
    this.now = now;
  }

  /** Starts the daily refresh without making provider availability a startup requirement. */
  public async start(): Promise<void> {
    await this.refresh();
    const timer = setInterval(() => {
      void this.refresh();
    }, DAY_MS);
    timer.unref();
  }

  /** Coalesces concurrent refreshes and never replaces a successful cache with a failed response. */
  public async refresh(): Promise<void> {
    this.refreshing ??= this.refreshOnce();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async refreshOnce(): Promise<void> {
    try {
      const response = await this.request(
        "https://openrouter.ai/api/v1/models",
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok)
        throw new Error(`OpenRouter catalog HTTP ${response.status}`);
      const input: unknown = await response.json();
      const fetchedAt = this.now().toISOString();
      const prices = parseOpenRouterPrices(input, fetchedAt);
      if (prices.length === 0)
        throw new Error("OpenRouter returned no usable Anthropic prices");
      await this.repository.save(fetchedAt, JSON.stringify(prices));
    } catch (error: unknown) {
      logCaughtError("OpenRouterPrices", error);
    }
  }
}
