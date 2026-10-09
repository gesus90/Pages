import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";
import { isReasoningEffortToken } from "@/definition/AgentModelCatalog";

import type { ApiProviderId } from "@/definition/AgentConnection";
import type {
  AgentCatalogModel,
  AgentReasoningSupport,
} from "@/definition/AgentModelCatalog";

export interface CatalogPage {
  readonly models: readonly AgentCatalogModel[];
  readonly nextCursor: string | null;
}

export type ReasoningFields = Pick<
  AgentCatalogModel,
  "reasoning" | "reasoningEfforts" | "defaultReasoningEffort"
>;

const REASONING_SUPPORT: readonly AgentReasoningSupport[] = [
  "levels",
  "automatic",
  "none",
  "unknown",
];

// Anthropic's ModelCapabilities names exactly these effort keys.
const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** Reasoning support that names no selectable effort. */
export function reasoningWithoutLevels(
  reasoning: AgentReasoningSupport,
): ReasoningFields {
  return { reasoning, reasoningEfforts: [], defaultReasoningEffort: null };
}

/** Accepts a short, duplicate-free list of effort tokens, or nothing. */
export function readReasoningEfforts(value: unknown): readonly string[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 8 ||
    !value.every(isReasoningEffortToken)
  )
    return null;
  return [...new Set(value)];
}

/** Keeps a listed default only when it is one of the listed efforts. */
export function reasoningLevels(
  efforts: readonly string[],
  fallback: unknown,
): ReasoningFields {
  return {
    reasoning: "levels",
    reasoningEfforts: efforts,
    defaultReasoningEffort:
      isReasoningEffortToken(fallback) && efforts.includes(fallback)
        ? fallback
        : null,
  };
}

// OpenRouter omits `reasoning` for non-reasoning models and lists efforts otherwise.
function readOpenRouterReasoning(value: unknown): ReasoningFields {
  if (value === undefined) return reasoningWithoutLevels("none");
  const reasoning = readAgentObject(value);
  const efforts = readReasoningEfforts(reasoning.supported_efforts);
  return efforts
    ? reasoningLevels(efforts, reasoning.default_effort)
    : reasoningWithoutLevels("automatic");
}

function readAnthropicReasoning(value: unknown): ReasoningFields {
  if (value === undefined || value === null)
    return reasoningWithoutLevels("unknown");
  const effort = readAgentObject(readAgentObject(value).effort);
  if (effort.supported !== true) return reasoningWithoutLevels("none");
  const efforts = ANTHROPIC_EFFORTS.filter(
    (level) => readAgentObject(effort[level]).supported === true,
  );
  return efforts.length > 0
    ? reasoningLevels(efforts, null)
    : reasoningWithoutLevels("none");
}

// Gemini's model resource only says whether a model thinks, not which levels it accepts.
const GOOGLE_THINKING: Readonly<Record<string, AgentReasoningSupport>> = {
  true: "automatic",
  false: "none",
};

function readReasoning(
  model: Record<string, unknown>,
  provider: ApiProviderId,
): ReasoningFields {
  if (provider === "openrouter")
    return readOpenRouterReasoning(model.reasoning);
  if (provider === "anthropic")
    return readAnthropicReasoning(model.capabilities);
  if (provider === "google_ai_studio" && typeof model.thinking === "boolean")
    return reasoningWithoutLevels(GOOGLE_THINKING[String(model.thinking)]);
  return reasoningWithoutLevels("unknown");
}

function readText(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\x00-\x1f\x7f]/.test(value)
    ? value
    : null;
}

function readPrice(value: unknown): string | null {
  const price = typeof value === "number" ? String(value) : value;
  return typeof price === "string" &&
    price.length <= 64 &&
    /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(price)
    ? price
    : null;
}

function isZeroPrice(price: string | null): boolean {
  return price !== null && /^0+(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(price);
}

function readModel(entry: unknown, provider: ApiProviderId): AgentCatalogModel {
  const model = readAgentObject(entry);
  const id = readText(
    provider === "google_ai_studio" ? model.name : model.id,
    200,
  );
  // OpenRouter lists alias IDs such as "~vendor/model-latest" next to regular ones.
  if (id === null || !/^~?[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id))
    throw new AgentError("provider_bad_response");
  const pricing = readAgentObject(model.pricing);
  const promptPrice =
    provider === "openrouter" ? readPrice(pricing.prompt) : null;
  const completionPrice =
    provider === "openrouter" ? readPrice(pricing.completion) : null;
  const context =
    provider === "google_ai_studio"
      ? model.inputTokenLimit
      : model.context_length;
  return {
    id,
    name:
      readText(model.displayName ?? model.display_name ?? model.name, 200) ??
      id,
    contextWindow:
      typeof context === "number" &&
      Number.isSafeInteger(context) &&
      context > 0
        ? context
        : null,
    promptPrice,
    completionPrice,
    isFree: isZeroPrice(promptPrice) && isZeroPrice(completionPrice),
    ...readReasoning(model, provider),
  };
}

function readCursor(
  result: Record<string, unknown>,
  provider: ApiProviderId,
): string | null {
  if (provider === "google_ai_studio") {
    if (result.nextPageToken === undefined || result.nextPageToken === "")
      return null;
    const cursor = readText(result.nextPageToken, 2048);
    if (cursor === null) throw new AgentError("provider_bad_response");
    return cursor;
  }
  if (provider === "anthropic") {
    if (typeof result.has_more !== "boolean")
      throw new AgentError("provider_bad_response");
    if (!result.has_more) return null;
    const cursor = readText(result.last_id, 200);
    if (cursor === null) throw new AgentError("provider_bad_response");
    return cursor;
  }
  // Never present an unexpected partial listing as a complete catalog.
  if (result.has_more === true) throw new AgentError("provider_bad_response");
  return null;
}

function readOpenRouterCursor(
  result: Record<string, unknown>,
  offset: number,
  count: number,
): string | null {
  if (result.has_more === true) throw new AgentError("provider_bad_response");
  const total = result.total_count;
  if (
    total !== undefined &&
    (typeof total !== "number" ||
      !Number.isSafeInteger(total) ||
      total < offset + count)
  )
    throw new AgentError("provider_bad_response");
  const hasMore =
    typeof total === "number" ? offset + count < total : count >= 1000;
  if (!hasMore) return null;
  if (count === 0) throw new AgentError("provider_bad_response");
  return String(offset + count);
}

/** Strictly parses a complete page without storing raw descriptions or provider bodies. */
export function parseCatalogPage(
  payload: unknown,
  provider: ApiProviderId,
  offset = 0,
): CatalogPage {
  const result = readAgentObject(payload);
  const entries = provider === "google_ai_studio" ? result.models : result.data;
  if (!Array.isArray(entries) || entries.length > 10_000)
    throw new AgentError("provider_bad_response");
  return {
    models: entries.map((entry: unknown) => readModel(entry, provider)),
    nextCursor:
      provider === "openrouter"
        ? readOpenRouterCursor(result, offset, entries.length)
        : readCursor(result, provider),
  };
}

function readStoredReasoning(entry: unknown): ReasoningFields {
  const stored = readAgentObject(entry);
  const support = REASONING_SUPPORT.find(
    (candidate) => candidate === stored.reasoning_support,
  );
  if (support !== "levels") return reasoningWithoutLevels(support ?? "unknown");
  const reasoning = readAgentObject(stored.reasoning);
  const efforts = readReasoningEfforts(reasoning.supported_efforts);
  return efforts
    ? reasoningLevels(efforts, reasoning.default_effort)
    : reasoningWithoutLevels("unknown");
}

/**
 * Reads a persisted snapshot; snapshots from before A7 §21.3 have no reasoning data.
 *
 * @param entries - The stored `models_json` array.
 * @returns The models with the reasoning support saved for each of them.
 */
export function parseStoredCatalog(
  entries: unknown,
): readonly AgentCatalogModel[] {
  if (!Array.isArray(entries)) throw new AgentError("provider_bad_response");
  const stored: readonly unknown[] = entries;
  const models = parseCatalogPage({ data: stored }, "openrouter").models;
  return models.map((model, index) => ({
    ...model,
    ...readStoredReasoning(stored[index]),
  }));
}
