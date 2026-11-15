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

interface PriceTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
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

function priceTokens(usage: AgentSessionTurnUsage): PriceTokens | null {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } =
    usage;
  const counts = [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens];
  if (
    inputTokens === null ||
    outputTokens === null ||
    cacheReadTokens === null ||
    cacheWriteTokens === null ||
    counts.some(
      (count) => count === null || !Number.isSafeInteger(count) || count < 0,
    )
  )
    return null;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function uncachedInput(
  usage: AgentSessionTurnUsage,
  tokens: PriceTokens,
): number | null {
  const { inputTokens, cacheReadTokens, cacheWriteTokens } = tokens;
  if (
    (usage.inputIncludesCache === null &&
      (cacheReadTokens > 0 || cacheWriteTokens > 0)) ||
    (usage.inputIncludesCache === true && cacheWriteTokens > 0)
  )
    return null;
  const input = inputTokens - (usage.inputIncludesCache ? cacheReadTokens : 0);
  return input < 0 ? null : input;
}

function estimate(
  usage: AgentSessionTurnUsage,
  model: ModelPrice,
): Pick<AgentSessionEstimate, "amountUsd" | "gap"> {
  const tokens = priceTokens(usage);
  if (tokens === null) return { amountUsd: null, gap: "tokens" };
  const input = uncachedInput(usage, tokens);
  if (input === null) return { amountUsd: null, gap: "cache_semantics" };
  const { outputTokens, cacheReadTokens, cacheWriteTokens } = tokens;
  if (
    (cacheReadTokens > 0 && model.inputCacheRead === null) ||
    (cacheWriteTokens > 0 && model.inputCacheWrite === null)
  )
    return { amountUsd: null, gap: "price" };
  const amountUsd =
    input * model.prompt +
    outputTokens * model.completion +
    cacheReadTokens * (model.inputCacheRead ?? 0) +
    cacheWriteTokens * (model.inputCacheWrite ?? 0);
  return Number.isFinite(amountUsd)
    ? { amountUsd, gap: null }
    : { amountUsd: null, gap: "price" };
}

/**
 * Public daily OpenRouter catalogue, adapted from PAGE-364 (8ca66416).
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

  /** Prices only captured counts; a Google selector needs an exact catalogue ID. */
  public async calculate(
    usage: AgentSessionTurnUsage,
  ): Promise<AgentSessionEstimate> {
    if (!usage.model)
      return { amountUsd: null, modelId: null, priceAsOf: null, gap: "model" };
    if (priceTokens(usage) === null)
      return { amountUsd: null, modelId: null, priceAsOf: null, gap: "tokens" };
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
        : { amountUsd: null, gap: "model" as const }),
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
