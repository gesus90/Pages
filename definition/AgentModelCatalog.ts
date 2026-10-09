import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentProviderId } from "./AgentConnection";

/** Persisted per-connection cadence, in hours; zero requires explicit refresh. */
export const CATALOG_INTERVALS = [0, 6, 24, 168] as const;
export type CatalogInterval = (typeof CATALOG_INTERVALS)[number];

/**
 * How the provider or CLI catalog describes reasoning control for one model.
 *
 * @remarks
 * `levels` lists selectable efforts; `automatic` means the model reasons but
 * the catalog names no selectable level; `none` means the catalog says the
 * model does not reason; `unknown` means the catalog carries no such data.
 */
export type AgentReasoningSupport = "levels" | "automatic" | "none" | "unknown";

/** Only whitelisted model metadata crosses the admin boundary. */
export interface AgentCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number | null;
  readonly promptPrice: string | null;
  readonly completionPrice: string | null;
  readonly isFree: boolean;
  readonly reasoning: AgentReasoningSupport;
  /** Efforts exactly as the provider or CLI lists them; empty unless `levels`. */
  readonly reasoningEfforts: readonly string[];
  readonly defaultReasoningEffort: string | null;
}

export interface AgentModelCatalog {
  readonly models: readonly AgentCatalogModel[];
  readonly intervalHours: CatalogInterval;
  readonly nextRefreshAt: string | null;
  readonly attemptedAt: string | null;
  readonly refreshedAt: string | null;
  readonly errorCode: AgentErrorCode | null;
}

/**
 * Z.AI has no documented, token-free catalog endpoint; CLIs list their models
 * themselves after login (A7 §21.3).
 */
export function supportsModelCatalog(provider: AgentProviderId): boolean {
  return provider !== "zai";
}

/** Effort names are short provider tokens such as `low` or `xhigh`. */
export function isReasoningEffortToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,23}$/.test(value);
}

/** Accepts only the administrative cadence choices. */
export function isCatalogInterval(value: number): value is CatalogInterval {
  return CATALOG_INTERVALS.some((interval) => interval === value);
}

/** Unsaved catalog state never implies a provider request. */
export function emptyModelCatalog(): AgentModelCatalog {
  return {
    models: [],
    intervalHours: 0,
    nextRefreshAt: null,
    attemptedAt: null,
    refreshedAt: null,
    errorCode: null,
  };
}
