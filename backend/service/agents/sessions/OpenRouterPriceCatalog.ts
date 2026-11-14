import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";

import type { OpenCodeMessageUsage } from "@/backend/agents/cli/OpenCodeSessionUsage";

interface ModelPrice {
  readonly id: string;
  readonly prompt: number;
  readonly completion: number;
  readonly inputCacheRead: number;
  readonly inputCacheWrite: number;
  readonly internalReasoning: number;
}

interface PriceSnapshot {
  readonly fetchedAt: string;
  readonly models: readonly ModelPrice[];
}

/** The cost of one native message and the source fixed at calculation time. */
export interface OpenCodeMessagePrice {
  readonly amount: number | null;
  readonly state: "free" | "catalog" | "native" | "unknown";
  readonly priceAsOf: string | null;
}

function object(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

function price(input: unknown): number | null {
  const parsed = typeof input === "string" ? Number(input) : input;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : null;
}

function modelPrice(input: unknown): ModelPrice | null {
  const entry = object(input);
  const pricing = object(entry?.pricing);
  const id = entry?.id;
  const prompt = price(pricing?.prompt);
  const completion = price(pricing?.completion);
  if (typeof id !== "string" || prompt === null || completion === null)
    return null;
  return {
    id,
    prompt,
    completion,
    inputCacheRead: price(pricing?.input_cache_read) ?? prompt,
    inputCacheWrite: price(pricing?.input_cache_write) ?? prompt,
    internalReasoning: price(pricing?.internal_reasoning) ?? completion,
  };
}

function snapshot(input: unknown): PriceSnapshot | null {
  const result = object(input);
  if (typeof result?.fetchedAt !== "string" || !Array.isArray(result.models))
    return null;
  const models = result.models.flatMap((entry) => {
    const stored = object(entry);
    const parsed = stored
      ? modelPrice({
          id: stored.id,
          pricing: {
            prompt: stored.prompt,
            completion: stored.completion,
            input_cache_read: stored.inputCacheRead,
            input_cache_write: stored.inputCacheWrite,
            internal_reasoning: stored.internalReasoning,
          },
        })
      : null;
    return parsed === null ? [] : [parsed];
  });
  return models.length > 0 ? { fetchedAt: result.fetchedAt, models } : null;
}

const ONE_DAY_MS = 86_400_000;
const catalogues = new Map<string, OpenRouterPriceCatalog>();

/** Returns a shared daily catalogue in the connection's persistent private home. */
export function openRouterPriceCatalog(directory: string): OpenRouterPriceCatalog {
  const existing = catalogues.get(directory);
  if (existing) return existing;
  const created = new OpenRouterPriceCatalog(path.join(directory, "openrouter-prices.json"));
  catalogues.set(directory, created);
  return created;
}

/** The public OpenRouter price list, retained for offline calculations. */
export class OpenRouterPriceCatalog {
  private readonly file: string;
  private current: PriceSnapshot | null = null;
  private loading: Promise<void> | null = null;
  private lastAttempt = 0;

  public constructor(file: string) {
    this.file = file;
  }

  /** Loads a saved snapshot and refreshes it at most once a day. */
  public async refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.load();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /** Prices one OpenCode message from free status, catalogue, then native cost. */
  public async calculate(
    message: OpenCodeMessageUsage,
    mapping?: Readonly<Record<string, string>>,
    isFreeModel = false,
  ): Promise<OpenCodeMessagePrice> {
    if (
      isFreeModel ||
      (message.model?.startsWith("opencode/") &&
        message.model.endsWith("-free"))
    )
      return { amount: 0, state: "free", priceAsOf: null };
    await this.refresh();
    const model = this.match(message.model, mapping);
    const tokens = this.completeTokens(message);
    if (model && tokens)
      return {
        amount:
          tokens.input * model.prompt +
          tokens.output * model.completion +
          tokens.reasoning * model.internalReasoning +
          tokens.cacheRead * model.inputCacheRead +
          tokens.cacheWrite * model.inputCacheWrite,
        state: "catalog",
        priceAsOf: this.current?.fetchedAt ?? null,
      };
    if (message.costUsd !== null)
      return { amount: message.costUsd, state: "native", priceAsOf: null };
    return { amount: null, state: "unknown", priceAsOf: null };
  }

  private completeTokens(message: OpenCodeMessageUsage): {
    readonly input: number;
    readonly output: number;
    readonly reasoning: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  } | null {
    const {
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
    } = message;
    if (
      inputTokens === null ||
      outputTokens === null ||
      reasoningTokens === null ||
      cacheReadTokens === null ||
      cacheWriteTokens === null
    )
      return null;
    return {
      input: inputTokens,
      output: outputTokens,
      reasoning: reasoningTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
    };
  }

  private match(
    model: string | null,
    mapping?: Readonly<Record<string, string>>,
  ): ModelPrice | null {
    if (!model || !this.current) return null;
    const mapped = mapping?.[model];
    const direct = mapped ?? model.replace(/^openrouter\//u, "");
    const exact = this.current.models.find((entry) => entry.id === direct);
    if (exact || mapped || model.startsWith("openrouter/"))
      return exact ?? null;
    const [provider, ...parts] = model.split("/");
    const upstream = provider === "zai" ? "z-ai" : provider;
    const name = parts.join("/");
    const matches = this.current.models.filter((entry) =>
      entry.id.startsWith(`${upstream}/`) &&
      entry.id.split("/").slice(1).join("/") === name,
    );
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }

  private async load(): Promise<void> {
    if (!this.current) {
      try {
        this.current = snapshot(JSON.parse(await readFile(this.file, "utf8")));
      } catch (error: unknown) {
        if (!object(error) || object(error)?.code !== "ENOENT")
          logCaughtError("OpenRouterPriceCatalog", error);
      }
    }
    if (
      this.current &&
      Date.now() - Date.parse(this.current.fetchedAt) < ONE_DAY_MS
    )
      return;
    if (Date.now() - this.lastAttempt < ONE_DAY_MS) return;
    this.lastAttempt = Date.now();
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("OpenRouter catalogue unavailable");
      const payload: unknown = await response.json();
      const entries = object(payload)?.data;
      if (!Array.isArray(entries)) throw new Error("Invalid OpenRouter catalogue");
      const models = entries.flatMap((entry) => {
        const parsed = modelPrice(entry);
        return parsed === null ? [] : [parsed];
      });
      if (models.length === 0) throw new Error("Empty OpenRouter catalogue");
      const current = { fetchedAt: new Date().toISOString(), models };
      await mkdir(path.dirname(this.file), { recursive: true });
      const pending = `${this.file}.pending`;
      await writeFile(pending, JSON.stringify(current), { mode: 0o600 });
      await rename(pending, this.file);
      this.current = current;
    } catch (error: unknown) {
      logCaughtError("OpenRouterPriceCatalog", error);
    }
  }
}
