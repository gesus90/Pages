import { parseClaudeModelId } from "./AgentModelVersion";

import type { AgentProviderId } from "./AgentConnection";

/** The reasoning levels the shared badge knows, from the least effort. */
export const REASONING_BADGE_LEVELS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;

/** A reasoning level the shared badge colors. */
export type ReasoningBadgeLevel = (typeof REASONING_BADGE_LEVELS)[number];

/** The vendor a shared model badge names beside its tile. */
export type ModelBadgeVendor = "anthropic" | "openai";

/**
 * The providers whose models carry the shared model badge, with their vendor.
 * @remarks
 * Every other provider keeps the grey pill of model and level.
 */
const MODEL_BADGE_VENDORS: Readonly<Record<string, ModelBadgeVendor>> = {
  claude_code: "anthropic",
  codex_cli: "openai",
};

/**
 * The vendor of a provider's shared model badge.
 * @param provider - A provider or runner, such as `codex_cli`; `null` when the connection is gone.
 * @returns `null` for a provider that keeps the grey pill.
 */
export function modelBadgeVendor(
  provider: string | null,
): ModelBadgeVendor | null {
  if (provider === null) return null;
  return Object.hasOwn(MODEL_BADGE_VENDORS, provider)
    ? (MODEL_BADGE_VENDORS[provider] ?? null)
    : null;
}

/**
 * Where a shown value comes from.
 * @remarks
 * `confirmed` is what the adapter reported for the running session,
 * `requested` what Pages asked it for and the adapter has not confirmed yet,
 * `configured` the setting of an agent outside of a running session.
 */
export type AgentValueStatus = "confirmed" | "requested" | "configured";

/** A model of a connection's catalog, as far as the badges need it. */
export interface AgentCatalogModelName {
  readonly id: string;
  /** The catalog name, such as `Haiku 5.5`. */
  readonly name: string;
  /** Short picker values that resolve to the model, such as `haiku`. */
  readonly aliases?: readonly string[];
  /** The reasoning levels the model offers; absent when the catalog states none. */
  readonly reasoningEfforts?: readonly string[];
}

/** The model of a session or an agent as structured identity, never as a joined text. */
export interface AgentModelIdentity {
  /** The provider of the connection, such as `claude_code`. */
  readonly provider: AgentProviderId;
  /** The canonical catalog ID; `null` when only an unresolved alias is known. */
  readonly modelId: string | null;
  /** The catalog name, or the reported value when the catalog does not know it. */
  readonly name: string;
  readonly status: AgentValueStatus;
}

/** The reasoning level of a session, kept apart from its model. */
export interface AgentReasoningIdentity {
  /** `null` follows the model's default, which no adapter confirmed as a level. */
  readonly value: string | null;
  readonly status: AgentValueStatus | "unknown";
  /** Whether the model offers the level; `null` when the catalog does not say. */
  readonly isOffered: boolean | null;
}

/** The model values of one session as Pages read and stored them. */
export interface AgentModelReading {
  readonly provider: AgentProviderId;
  /** What Pages asked for: a catalog ID or an alias. */
  readonly requested: string | null;
  /** What the adapter confirmed as its configuration, possibly an alias such as `haiku`. */
  readonly configured: string | null;
  /** The concrete model the adapter reported with its usage, such as `claude-haiku-5-5`. */
  readonly reported: string | null;
  readonly catalog: readonly AgentCatalogModelName[];
}

/** Whether a reasoning value names a level of the shared badge. */
export function isReasoningBadgeLevel(
  value: string,
): value is ReasoningBadgeLevel {
  return (REASONING_BADGE_LEVELS as readonly string[]).includes(value);
}

function capitalize(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** The catalog entry of a canonical ID; an alias never matches here. */
function byId(
  catalog: readonly AgentCatalogModelName[],
  id: string | null,
): AgentCatalogModelName | null {
  if (id === null) return null;
  return catalog.find((entry) => entry.id === id) ?? null;
}

/** The single catalog entry an alias resolves to; `null` when none or several match. */
function byAlias(
  catalog: readonly AgentCatalogModelName[],
  alias: string | null,
): AgentCatalogModelName | null {
  if (alias === null) return null;
  const matches = catalog.filter((entry) => entry.aliases?.includes(alias));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * The name of a concrete model the catalog does not list.
 * @remarks
 * A versioned Claude ID names its family and version itself, so
 * `claude-haiku-5-5` reads `Haiku 5.5`; any other value stays as reported.
 */
function uncatalogedName(id: string): string {
  const parts = parseClaudeModelId(id);
  return parts ? `${capitalize(parts.family)} ${parts.version}` : id;
}

/**
 * Resolves the model of a session into its structured identity.
 * @remarks
 * Only the concrete model the adapter reported confirms a version: an alias
 * such as `haiku` the adapter confirmed as its configuration says which
 * family runs, not which version, so it stays `requested` until the reported
 * model arrives. Codex confirms a concrete model ID through its
 * configuration option, so that value is confirmed, with its catalog name or
 * as the raw ID. The reported model wins over every requested value, so a
 * changed or resumed session never keeps an older name.
 * @returns `null` when nothing names a model.
 */
export function resolveModelIdentity(
  reading: AgentModelReading,
): AgentModelIdentity | null {
  return confirmedModelIdentity(reading) ?? requestedModelIdentity(reading);
}

/** The model identity an adapter confirmed; `null` while only a request is known. */
function confirmedModelIdentity(
  reading: AgentModelReading,
): AgentModelIdentity | null {
  const { provider, catalog, reported, configured } = reading;
  if (reported !== null) {
    const entry = byId(catalog, reported);
    return {
      provider,
      modelId: reported,
      name: entry?.name ?? uncatalogedName(reported),
      status: "confirmed",
    };
  }
  const configuredEntry = byId(catalog, configured);
  if (configuredEntry)
    return {
      provider,
      modelId: configuredEntry.id,
      name: configuredEntry.name,
      status: "confirmed",
    };
  // A concrete Claude ID the adapter confirmed names its version itself;
  // Codex confirms only concrete model IDs, never an alias.
  if (
    configured !== null &&
    (provider === "codex_cli" || parseClaudeModelId(configured))
  )
    return {
      provider,
      modelId: configured,
      name: uncatalogedName(configured),
      status: "confirmed",
    };
  return null;
}

/** The model identity of a value Pages requested that the adapter has not confirmed. */
function requestedModelIdentity(
  reading: AgentModelReading,
): AgentModelIdentity | null {
  const { provider, catalog, requested, configured } = reading;
  const requestedValue = configured ?? requested;
  if (requestedValue === null) return null;
  const entry =
    byId(catalog, requested) ??
    byAlias(catalog, configured) ??
    byAlias(catalog, requested);
  return {
    provider,
    modelId: entry?.id ?? null,
    name: entry?.name ?? requestedValue,
    status: "requested",
  };
}

/**
 * Resolves the reasoning level of a session.
 * @remarks
 * A missing value is the model's default and stays unknown: it never reads as
 * `none` and never as a confirmed `medium`. Whether the model offers a level
 * comes from the catalog entry of the resolved model only.
 */
export function resolveReasoningIdentity(input: {
  readonly requested: string | null;
  readonly confirmed: string | null;
  readonly model: AgentModelIdentity | null;
  readonly catalog: readonly AgentCatalogModelName[];
}): AgentReasoningIdentity {
  const value =
    normalReasoning(input.confirmed) ?? normalReasoning(input.requested);
  let status: AgentReasoningIdentity["status"] = "unknown";
  if (value !== null)
    status =
      normalReasoning(input.confirmed) === null ? "requested" : "confirmed";
  const offered = byId(
    input.catalog,
    input.model?.modelId ?? null,
  )?.reasoningEfforts;
  return {
    value,
    status,
    isOffered:
      value === null || offered === undefined ? null : offered.includes(value),
  };
}

/** `default` and an empty value name no level. */
function normalReasoning(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "default" ? null : trimmed;
}
