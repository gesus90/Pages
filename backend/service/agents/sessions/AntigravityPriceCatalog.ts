import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { AgentSessionEstimate } from "@/definition/AgentSessionPricing";

const ONE_DAY_MS = 86_400_000;

interface ModelPrice {
  readonly id: string;
  readonly prompt: number;
  readonly completion: number;
  readonly inputCacheRead: number | null;
  readonly inputCacheWrite: number | null;
}

interface PriceSnapshot {
  readonly fetchedAt: string;
  readonly models: readonly ModelPrice[];
}

/** The counts of a turn as reported; `null` for a count the turn did not report. */
interface PriceTokens {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
}

/** One count of a turn with the rate of a single token; either may be missing. */
interface PricedCount {
  readonly tokens: number | null;
  readonly rate: number | null;
}

function price(input: unknown): number | null {
  if (typeof input === "string" && input.trim() === "") return null;
  const parsed = typeof input === "string" ? Number(input) : input;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : null;
}

function modelPrice(input: unknown): ModelPrice | null {
  const entry = readAgentObject(input);
  const pricing = readAgentObject(entry.pricing);
  const prompt = price(pricing.prompt);
  const completion = price(pricing.completion);
  if (typeof entry.id !== "string" || prompt === null || completion === null)
    return null;
  return {
    id: entry.id,
    prompt,
    completion,
    inputCacheRead: price(pricing.input_cache_read),
    inputCacheWrite: price(pricing.input_cache_write),
  };
}

function snapshot(input: unknown): PriceSnapshot | null {
  const stored = readAgentObject(input);
  if (
    typeof stored.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(stored.fetchedAt)) ||
    !Array.isArray(stored.models)
  )
    return null;
  const models = stored.models.flatMap((entry: unknown) => {
    const model = readAgentObject(entry);
    const parsed = modelPrice({
      id: model.id,
      pricing: {
        prompt: model.prompt,
        completion: model.completion,
        input_cache_read: model.inputCacheRead,
        input_cache_write: model.inputCacheWrite,
      },
    });
    return parsed ? [parsed] : [];
  });
  return models.length ? { fetchedAt: stored.fetchedAt, models } : null;
}

/** The counts a turn reported; `null` without any count or with a count that is no token count. */
function priceTokens(usage: AgentSessionTurnUsage): PriceTokens | null {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } =
    usage;
  const counts = [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens];
  if (
    counts.every((count) => count === null) ||
    counts.some(
      (count) => count !== null && (!Number.isSafeInteger(count) || count < 0),
    )
  )
    return null;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

/**
 * The input that is priced at the prompt rate.
 * @returns The input without cache reads, `null` for a turn that reported no
 * input, and `undefined` when the counts cannot say what the input contains.
 */
function uncachedInput(
  usage: AgentSessionTurnUsage,
  tokens: PriceTokens,
): number | null | undefined {
  const { inputTokens, cacheReadTokens, cacheWriteTokens } = tokens;
  if (inputTokens === null) return null;
  if (usage.inputIncludesCache === false) return inputTokens;
  // A missing cache count may be part of the input, so it counts like a positive one.
  const hasCacheReads = cacheReadTokens !== 0;
  const hasCacheWrites = cacheWriteTokens !== 0;
  if (usage.inputIncludesCache === null)
    return hasCacheReads || hasCacheWrites ? undefined : inputTokens;
  if (hasCacheWrites || cacheReadTokens === null) return undefined;
  const input = inputTokens - cacheReadTokens;
  return input < 0 ? undefined : input;
}

/** The amount of the reported counts; a count without a rate has no price. */
function amountOf(counts: readonly PricedCount[]): number | null {
  let amountUsd = 0;
  for (const { tokens, rate } of counts) {
    if (tokens === null || tokens === 0) continue;
    if (rate === null) return null;
    amountUsd += tokens * rate;
  }
  return Number.isFinite(amountUsd) ? amountUsd : null;
}

function estimate(
  usage: AgentSessionTurnUsage,
  model: ModelPrice,
): Pick<AgentSessionEstimate, "amountUsd" | "gap" | "isPartial"> {
  const tokens = priceTokens(usage);
  if (tokens === null)
    return { amountUsd: null, gap: "tokens", isPartial: false };
  const input = uncachedInput(usage, tokens);
  if (input === undefined)
    return { amountUsd: null, gap: "cache_semantics", isPartial: false };
  const counts: readonly PricedCount[] = [
    { tokens: input, rate: model.prompt },
    { tokens: tokens.outputTokens, rate: model.completion },
    { tokens: tokens.cacheReadTokens, rate: model.inputCacheRead },
    { tokens: tokens.cacheWriteTokens, rate: model.inputCacheWrite },
  ];
  const amountUsd = amountOf(counts);
  if (amountUsd === null)
    return { amountUsd: null, gap: "price", isPartial: false };
  return {
    amountUsd,
    gap: null,
    isPartial: counts.some((count) => count.tokens === null),
  };
}

/**
 * Public daily OpenRouter catalogue, adapted (8ca66416).
 * Missing cache rates remain unknown; subscription costs never enter it.
 */
export class AntigravityPriceCatalog {
  private readonly file: string;
  private current: PriceSnapshot | null = null;
  private loading: Promise<void> | null = null;
  private lastAttempt: number | null = null;

  public constructor(file: string) {
    this.file = file;
  }

  /** Loads an offline snapshot and attempts at most one refresh per day. */
  public async refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.load();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /**
   * Prices only captured counts; a Google selector needs an exact catalogue ID.
   * @param usage - The counts of one turn; a count it lacks is left out and marks the amount as partial.
   */
  public async calculate(
    usage: AgentSessionTurnUsage,
  ): Promise<AgentSessionEstimate> {
    const unpriced = {
      amountUsd: null,
      isPartial: false,
      modelId: null,
      priceAsOf: null,
    };
    if (!usage.model) return { ...unpriced, gap: "model" };
    if (priceTokens(usage) === null) return { ...unpriced, gap: "tokens" };
    await this.refresh();
    const direct = usage.model.replace(/^openrouter\//u, "");
    const model =
      this.current?.models.find((entry) => entry.id === direct) ??
      (usage.provider === "antigravity" && !direct.includes("/")
        ? this.current?.models.find((entry) => entry.id === `google/${direct}`)
        : null);
    return {
      ...(model
        ? estimate(usage, model)
        : { amountUsd: null, gap: "model" as const, isPartial: false }),
      modelId: model?.id ?? null,
      priceAsOf: this.current?.fetchedAt ?? null,
    };
  }

  private async load(): Promise<void> {
    if (!this.current) {
      try {
        this.current = snapshot(JSON.parse(await readFile(this.file, "utf8")));
      } catch (error: unknown) {
        if (readAgentObject(error).code !== "ENOENT")
          logCaughtError("AntigravityPriceCatalog", error);
      }
    }
    if (
      this.current &&
      Date.now() - Date.parse(this.current.fetchedAt) < ONE_DAY_MS
    )
      return;
    if (this.lastAttempt !== null && Date.now() - this.lastAttempt < ONE_DAY_MS)
      return;
    this.lastAttempt = Date.now();
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("OpenRouter catalogue unavailable");
      const payload: unknown = await response.json();
      const entries = readAgentObject(payload).data;
      if (!Array.isArray(entries))
        throw new Error("Invalid OpenRouter catalogue");
      const models = entries.flatMap((entry: unknown) => {
        const parsed = modelPrice(entry);
        return parsed ? [parsed] : [];
      });
      if (!models.length) throw new Error("Empty OpenRouter catalogue");
      const current = { fetchedAt: new Date().toISOString(), models };
      await mkdir(path.dirname(this.file), { recursive: true });
      const pending = `${this.file}.pending`;
      await writeFile(pending, JSON.stringify(current), { mode: 0o600 });
      await rename(pending, this.file);
      this.current = current;
    } catch (error: unknown) {
      logCaughtError("AntigravityPriceCatalog", error);
    }
  }
}
