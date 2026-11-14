import { logCaughtError } from "@/backend/logging/Logger";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const DAY_MS = 86_400_000;

/** Per-token USD prices from the public OpenRouter catalog. */
export interface OpenRouterPrices {
  readonly prompt: number;
  readonly completion: number;
  readonly inputCacheRead: number;
  readonly inputCacheWrite: number;
  readonly internalReasoning: number;
}

/** The persisted public catalog at one fetch time. */
export interface CatalogSnapshot {
  readonly fetchedAt: string;
  readonly prices: Readonly<Record<string, OpenRouterPrices>>;
}

/** Storage boundary for the public catalog, independent of live access. */
export interface OpenRouterPriceStore {
  load(): Promise<{ readonly fetchedAt: string; readonly prices: unknown } | null>;
  save(snapshot: CatalogSnapshot): Promise<void>;
}

/** A calculated OpenRouter charge, including the exact price stand. */
export interface OpenRouterCharge {
  readonly state: "known" | "free" | "unknown";
  readonly amount: number | null;
  readonly prices: OpenRouterPrices | null;
  readonly pricedAt: string | null;
}

/** Counts OpenCode keeps separate from both cached input and reasoning output. */
export interface OpenRouterTokenCounts {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

function record(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

function price(input: unknown): number | null {
  const amount = typeof input === "string" ? Number(input) : input;
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    ? amount
    : null;
}

function isDue(snapshot: CatalogSnapshot | null): boolean {
  return snapshot === null || !Number.isFinite(Date.parse(snapshot.fetchedAt)) ||
    Date.now() - Date.parse(snapshot.fetchedAt) >= DAY_MS;
}

function parseSavedPrices(input: unknown): Readonly<Record<string, OpenRouterPrices>> | null {
  const entries = record(input);
  if (!entries) return null;
  const prices: Record<string, OpenRouterPrices> = {};
  for (const [model, raw] of Object.entries(entries)) {
    const rates = record(raw);
    const prompt = price(rates?.prompt);
    const completion = price(rates?.completion);
    const inputCacheRead = price(rates?.inputCacheRead);
    const inputCacheWrite = price(rates?.inputCacheWrite);
    const internalReasoning = price(rates?.internalReasoning);
    if (prompt === null || completion === null || inputCacheRead === null || inputCacheWrite === null || internalReasoning === null)
      return null;
    prices[model] = { prompt, completion, inputCacheRead, inputCacheWrite, internalReasoning };
  }
  return prices;
}

/** Parses only the five token rates that plan usage can bill. */
export function parseOpenRouterCatalog(input: unknown): Readonly<Record<string, OpenRouterPrices>> {
  const entries = record(input)?.data;
  if (!Array.isArray(entries)) throw new Error("Invalid OpenRouter catalog");
  const prices: Record<string, OpenRouterPrices> = {};
  for (const entry of entries) {
    const model = record(entry);
    const pricing = record(model?.pricing);
    const prompt = price(pricing?.prompt);
    const completion = price(pricing?.completion);
    if (typeof model?.id !== "string" || prompt === null || completion === null) continue;
    prices[model.id] = {
      prompt,
      completion,
      inputCacheRead: price(pricing?.input_cache_read) ?? prompt,
      inputCacheWrite: price(pricing?.input_cache_write) ?? prompt,
      internalReasoning: price(pricing?.internal_reasoning) ?? completion,
    };
  }
  return prices;
}

/** Calculates a message from the price snapshot, never OpenCode's own cost. */
export function chargeOpenRouterMessage(
  model: string,
  tokens: OpenRouterTokenCounts,
  snapshot: CatalogSnapshot | null,
): OpenRouterCharge {
  const modelId = model.startsWith("openrouter/") ? model.slice(11) : model;
  const prices = snapshot?.prices[modelId] ?? null;
  const pricedAt = snapshot?.fetchedAt ?? null;
  if (modelId.endsWith(":free") || (prices?.prompt === 0 && prices.completion === 0))
    return { state: "free", amount: 0, prices, pricedAt };
  if (!prices) return { state: "unknown", amount: null, prices: null, pricedAt };
  return {
    state: "known",
    amount:
      tokens.input * prices.prompt +
      tokens.output * prices.completion +
      tokens.reasoning * prices.internalReasoning +
      tokens.cacheRead * prices.inputCacheRead +
      tokens.cacheWrite * prices.inputCacheWrite,
    prices,
    pricedAt,
  };
}

/** Stores one catalog snapshot and refreshes it at startup and daily. */
export class OpenRouterPricing {
  private readonly store: OpenRouterPriceStore;
  private snapshot: CatalogSnapshot | null = null;
  private refreshing: Promise<void> | null = null;
  private lastAttemptAt = 0;

  public constructor(store: OpenRouterPriceStore) {
    this.store = store;
  }

  /** Loads the saved prices before attempting a network refresh. */
  public async start(): Promise<void> {
    const saved = await this.store.load();
    if (saved) {
      const prices = parseSavedPrices(saved.prices);
      if (prices) this.snapshot = { fetchedAt: saved.fetchedAt, prices };
    }
    await this.refreshIfDue();
  }

  /** Returns the latest stored catalog while a due refresh runs. */
  public current(): CatalogSnapshot | null {
    if (isDue(this.snapshot) && Date.now() - this.lastAttemptAt >= DAY_MS)
      void this.refreshIfDue();
    return this.snapshot;
  }

  /** Fetches once per day; a failure retains the saved stand. */
  public async refreshIfDue(): Promise<void> {
    if (!isDue(this.snapshot) || Date.now() - this.lastAttemptAt < DAY_MS) return;
    if (this.refreshing) return this.refreshing;
    this.lastAttemptAt = Date.now();
    this.refreshing = this.fetchCatalog();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async fetchCatalog(): Promise<void> {
    try {
      const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`OpenRouter catalog HTTP ${response.status}`);
      const prices = parseOpenRouterCatalog(await response.json());
      const fetchedAt = new Date().toISOString();
      await this.store.save({ fetchedAt, prices });
      this.snapshot = { fetchedAt, prices };
    } catch (error: unknown) {
      logCaughtError("OpenRouterPricing", error);
    }
  }
}
