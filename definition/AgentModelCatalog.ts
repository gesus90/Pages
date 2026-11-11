import { AGENT_PROVIDERS } from "./AgentConnection";

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
  /** Present only when the model catalog explicitly advertises image input support. */
  readonly supportsImages?: boolean;
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
  /**
   * Short names the CLI's own picker resolves to this model, such as `sonnet`.
   *
   * @remarks
   * Absent where the catalog does not say, which is every catalog saved
   * before the CLI's picker values were kept and every API catalog.
   */
  readonly aliases?: readonly string[];
  /**
   * Whether the model calls tools, as OpenCode or OpenRouter states it.
   *
   * @remarks
   * Absent where the catalog does not say, which is every other API and CLI
   * catalog. Agents leave out only a model that states `false`.
   */
  readonly isToolCapable?: boolean;
  /**
   * The input modalities the source states, such as `text` and `image`.
   *
   * @remarks
   * Kept by catalog refreshes since PAGE-248 from OpenRouter's
   * `architecture.input_modalities` and OpenCode's `capabilities.input`;
   * absent in older snapshots and in catalogs that state none.
   */
  readonly inputModalities?: readonly string[];
  /** The output modalities the source states, like {@link AgentCatalogModel.inputModalities}. */
  readonly outputModalities?: readonly string[];
  /**
   * The voice IDs of a speech output model, as OpenRouter's
   * `supported_voices` lists them (PAGE-300).
   *
   * @remarks
   * Absent where the catalog lists none, which is every model but a speech
   * output model and every snapshot saved before PAGE-300.
   */
  readonly supportedVoices?: readonly string[];
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
 * Supported API connections use metadata endpoints; CLI connections list
 * their native catalogs without generating model output.
 */
export function supportsModelCatalog(provider: AgentProviderId): boolean {
  return Object.hasOwn(AGENT_PROVIDERS, provider);
}

/** A picker alias such as `sonnet` or `opus[1m]`, short enough to store beside the model. */
export function isModelAliasToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9-]{0,39}(?:\[[0-9a-z]{1,8}\])?$/u.test(value)
  );
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

/**
 * Whether the last refresh of any catalog failed.
 *
 * @remarks
 * The server keeps the catalogs current; a model choice shows the models it
 * loaded with the page and warns only after a failed refresh.
 *
 * @param catalogs - The catalogs of the page, by connection.
 * @returns `true` when a catalog keeps an error of its last refresh.
 */
export function hasFailedCatalog(
  catalogs: Readonly<Record<string, AgentModelCatalog>>,
): boolean {
  return Object.values(catalogs).some((catalog) => catalog.errorCode !== null);
}
