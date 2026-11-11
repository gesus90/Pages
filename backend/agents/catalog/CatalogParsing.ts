import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  isModelAliasToken,
  isReasoningEffortToken,
} from "@/definition/AgentModelCatalog";
import { describeClaudeModel } from "@/definition/AgentModelVersion";

import { isCatalogModel } from "./CatalogTextModels";
import {
  documentedGoogleThinkingLevels,
  OPENROUTER_BUDGET_EFFORTS,
  OPENROUTER_GATEWAY_EFFORTS,
} from "./DocumentedReasoningLevels";

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

// Anthropic lists its effort capabilities alphabetically; its documentation
// orders the levels from `low` to `max`.
const ANTHROPIC_EFFORT_LADDER: readonly string[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Accepts the model IDs every catalog may list and Pages may store.
 *
 * @param value - A listed or stored model ID.
 * @returns Whether the ID is safe to save, show and pass on unchanged.
 *
 * @remarks
 * OpenRouter aliases start with `~`. Claude Code names its 1M-context
 * variants with a bracketed suffix such as `claude-opus-5-5[1m]`.
 */
export function isCatalogModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 200 &&
    /^~?[A-Za-z0-9][A-Za-z0-9._:/-]*(?:\[[0-9a-z]{1,16}\])?$/.test(value)
  );
}

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

// OpenRouter documents three forms of `supported_efforts`: a list, `null` for
// every gateway effort, and an omitted list for models without effort
// selection. Models that only take a token budget convert efforts instead.
function readOpenRouterEfforts(
  reasoning: Record<string, unknown>,
): readonly string[] | null {
  if (reasoning.supported_efforts === null) return OPENROUTER_GATEWAY_EFFORTS;
  if (reasoning.supported_efforts !== undefined)
    return readReasoningEfforts(reasoning.supported_efforts);
  return reasoning.supports_max_tokens === true
    ? OPENROUTER_BUDGET_EFFORTS
    : null;
}

// OpenRouter omits `reasoning` for non-reasoning models and router models.
function readOpenRouterReasoning(value: unknown): ReasoningFields {
  if (value === undefined) return reasoningWithoutLevels("none");
  const reasoning = readAgentObject(value);
  // A mandatory reasoning model rejects the effort "none".
  const efforts = (readOpenRouterEfforts(reasoning) ?? []).filter(
    (effort) => reasoning.mandatory !== true || effort !== "none",
  );
  return efforts.length > 0
    ? reasoningLevels(efforts, reasoning.default_effort)
    : reasoningWithoutLevels("automatic");
}

function ladderRank(effort: string): number {
  const rank = ANTHROPIC_EFFORT_LADDER.indexOf(effort);
  return rank === -1 ? ANTHROPIC_EFFORT_LADDER.length : rank;
}

function readAnthropicReasoning(value: unknown): ReasoningFields {
  if (value === undefined || value === null)
    return reasoningWithoutLevels("unknown");
  const effort = readAgentObject(readAgentObject(value).effort);
  if (effort.supported !== true) return reasoningWithoutLevels("none");
  const efforts = readReasoningEfforts(
    Object.keys(effort)
      .filter(
        (level) =>
          isReasoningEffortToken(level) &&
          readAgentObject(effort[level]).supported === true,
      )
      .sort((left, right) => ladderRank(left) - ladderRank(right)),
  );
  return efforts
    ? reasoningLevels(efforts, null)
    : reasoningWithoutLevels("none");
}

// Gemini's model resource only says whether a model thinks; the levels come
// from Google's documented table for exactly that model (A8.4-Fix2-E04).
function readGoogleReasoning(
  model: Record<string, unknown>,
  id: string,
): ReasoningFields {
  if (model.thinking === false) return reasoningWithoutLevels("none");
  if (model.thinking !== true) return reasoningWithoutLevels("unknown");
  const documented = documentedGoogleThinkingLevels(
    id.replace(/^models\//, ""),
  );
  return documented
    ? reasoningLevels(documented.efforts, documented.defaultEffort)
    : reasoningWithoutLevels("automatic");
}

function readReasoning(
  model: Record<string, unknown>,
  provider: ApiProviderId,
  id: string,
): ReasoningFields {
  if (provider === "openrouter")
    return readOpenRouterReasoning(model.reasoning);
  const listedReasoning = readAgentObject(model.reasoning);
  const efforts = readReasoningEfforts(listedReasoning.supported_efforts);
  if (efforts) return reasoningLevels(efforts, listedReasoning.default_effort);
  if (provider === "anthropic")
    return readAnthropicReasoning(model.capabilities);
  if (provider === "google_ai_studio") return readGoogleReasoning(model, id);
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

function readImageCapability(entry: unknown): {
  readonly supportsImages?: boolean;
} {
  const model = readAgentObject(entry);
  if (typeof model.image_input === "boolean")
    return { supportsImages: model.image_input };
  const modalities = readAgentObject(model.architecture).input_modalities;
  return Array.isArray(modalities) &&
    modalities.every((item) => typeof item === "string")
    ? { supportsImages: modalities.includes("image") }
    : {};
}

function readModalityList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const modalities = value.filter(
    (item): item is string =>
      typeof item === "string" && /^[a-z_-]{1,32}$/u.test(item),
  );
  return modalities.length === value.length ? modalities : undefined;
}

const VOICE_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.:@()+-]{0,99}$/u;

// OpenRouter lists the voices of a speech output model in `supported_voices`
// (PAGE-300); a stored snapshot keeps them under the same name. An unreadable
// list counts as none, so the voice tab asks for a voice ID instead.
function readSupportedVoices(entry: unknown): {
  readonly supportedVoices?: readonly string[];
} {
  const voices = readAgentObject(entry).supported_voices;
  if (!Array.isArray(voices) || voices.length === 0 || voices.length > 500)
    return {};
  const ids = voices.filter(
    (voice): voice is string =>
      typeof voice === "string" && VOICE_ID_PATTERN.test(voice),
  );
  return ids.length === voices.length
    ? { supportedVoices: [...new Set(ids)] }
    : {};
}

// OpenRouter states the modalities in `architecture` and tool calls as the
// `tools` parameter; the chat filter of the model choice decides by them.
function readOpenRouterChatFacts(
  entry: unknown,
): Pick<
  AgentCatalogModel,
  "inputModalities" | "outputModalities" | "isToolCapable"
> {
  const model = readAgentObject(entry);
  const architecture = readAgentObject(model.architecture);
  const inputModalities = readModalityList(architecture.input_modalities);
  const outputModalities = readModalityList(architecture.output_modalities);
  return {
    ...(inputModalities ? { inputModalities } : {}),
    ...(outputModalities ? { outputModalities } : {}),
    ...(Array.isArray(model.supported_parameters)
      ? { isToolCapable: model.supported_parameters.includes("tools") }
      : {}),
  };
}

function readModel(entry: unknown, provider: ApiProviderId): AgentCatalogModel {
  const model = readAgentObject(entry);
  const id = provider === "google_ai_studio" ? model.name : model.id;
  if (!isCatalogModelId(id)) throw new AgentError("provider_bad_response");
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
    ...readImageCapability(entry),
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
    ...readReasoning(model, provider, id),
    ...(provider === "openrouter" ? readOpenRouterChatFacts(entry) : {}),
    ...(provider === "openrouter" ? readSupportedVoices(entry) : {}),
  };
}

function readEntries(payload: unknown): readonly unknown[] {
  if (!Array.isArray(payload) || payload.length > 10_000)
    throw new AgentError("provider_bad_response");
  return payload;
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

/**
 * Strictly parses a complete page without storing raw descriptions or provider bodies.
 *
 * @param payload - One page as the provider returned it.
 * @param provider - The provider that returned the page.
 * @param offset - OpenRouter's offset of this page.
 * @returns The page's text, transcription and speech output models and the
 * cursor of the next page.
 *
 * @remarks
 * Only entries that the catalog's own metadata marks as text models
 * (A8.4-Fix2-E02), as transcription models (PAGE-294) or as speech output
 * models (PAGE-300) are kept. Pagination
 * still counts every listed entry.
 */
export function parseCatalogPage(
  payload: unknown,
  provider: ApiProviderId,
  offset = 0,
): CatalogPage {
  const result = readAgentObject(payload);
  const entries = readEntries(
    provider === "google_ai_studio" ? result.models : result.data,
  );
  return {
    models: entries
      .filter((entry) => isCatalogModel(entry, provider))
      .map((entry) => readModel(entry, provider)),
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

// Only snapshots of a Claude CLI picker saved after its short names were kept carry aliases.
function readStoredAliases(entry: unknown): {
  readonly aliases?: readonly string[];
} {
  const { aliases } = readAgentObject(entry);
  if (!Array.isArray(aliases)) return {};
  const tokens = aliases.filter(isModelAliasToken).slice(0, 8);
  return tokens.length > 0 ? { aliases: tokens } : {};
}

function readStoredToolCall(entry: unknown): {
  readonly isToolCapable?: boolean;
} {
  const toolCall = readAgentObject(entry).tool_call;
  return typeof toolCall === "boolean" ? { isToolCapable: toolCall } : {};
}

// Snapshots saved before PAGE-248 state no modalities, which hides no model.
function readStoredModalities(
  entry: unknown,
): Pick<AgentCatalogModel, "inputModalities" | "outputModalities"> {
  const stored = readAgentObject(entry);
  const inputModalities = readModalityList(stored.input_modalities);
  const outputModalities = readModalityList(stored.output_modalities);
  return {
    ...(inputModalities ? { inputModalities } : {}),
    ...(outputModalities ? { outputModalities } : {}),
  };
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
  // Snapshots retain the explicit input capability, including text-only models.
  return readEntries(entries).map((entry) => {
    const model = {
      ...readModel(entry, "openrouter"),
      ...readStoredReasoning(entry),
      ...readStoredAliases(entry),
      ...readStoredToolCall(entry),
      ...readStoredModalities(entry),
    };
    // Snapshots of the Claude CLI picker from before the version was part of the name keep their stored name.
    return { ...model, name: describeClaudeModel(model.id, model.name) };
  });
}
