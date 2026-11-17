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
 * model arrives. The reported model wins over every requested value, so a
 * changed or resumed session never keeps an older name.
 * @returns `null` when nothing names a model.
 */
export function resolveModelIdentity(
  reading: AgentModelReading,
): AgentModelIdentity | null {
  const { provider, catalog } = reading;
  if (reading.reported !== null) {
    const entry = byId(catalog, reading.reported);
    return {
      provider,
      modelId: reading.reported,
      name: entry?.name ?? uncatalogedName(reading.reported),
      status: "confirmed",
    };
  }
  const configuredEntry = byId(catalog, reading.configured);
  if (configuredEntry)
    return {
      provider,
      modelId: configuredEntry.id,
      name: configuredEntry.name,
      status: "confirmed",
    };
  // A concrete Claude ID the adapter confirmed names its version itself.
  if (reading.configured !== null && parseClaudeModelId(reading.configured))
    return {
      provider,
      modelId: reading.configured,
      name: uncatalogedName(reading.configured),
      status: "confirmed",
    };
  const requested = reading.configured ?? reading.requested;
  if (requested === null) return null;
  const entry =
    byId(catalog, reading.requested) ??
    byAlias(catalog, reading.configured) ??
    byAlias(catalog, reading.requested);
  return {
    provider,
    modelId: entry?.id ?? null,
    name: entry?.name ?? requested,
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
