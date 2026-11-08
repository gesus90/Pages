/**
 * What OpenCode states about one model in `opencode models --verbose`.
 *
 * @remarks
 * Only these properties decide whether a model may be chosen; names and IDs
 * never do, so no model is removed by guessing from how it is called. A
 * property OpenCode does not state at all removes no model; OpenCode states
 * all of them for every model it lists.
 */
export interface AgentModelTraits {
  /** OpenCode's `status`, such as `active`, `beta` or `deprecated`. */
  readonly status: unknown;
  /** OpenCode's `capabilities.input` modalities; absent where a catalog does not report them. */
  readonly input?: unknown;
  /** OpenCode's `capabilities.output` modalities. */
  readonly output: unknown;
  /** OpenCode's `capabilities.toolcall`. */
  readonly toolCall: unknown;
}

const GENERATED_MEDIA = ["image", "video", "audio"] as const;

function statesModality(
  modalities: unknown,
  modality: string,
  stated: boolean,
): boolean {
  return (
    typeof modalities === "object" &&
    modalities !== null &&
    Reflect.get(modalities, modality) === stated
  );
}

/**
 * The global filter for every chat model choice: an active language model
 * that reads and answers in text and generates no image, video or audio.
 *
 * @remarks
 * A model that also reads images stays a chat model. A model that states it
 * reads no text, such as a pure transcription model, is not one.
 *
 * @param traits - The model's properties as OpenCode states them.
 * @returns `true` when Pica and plans may list the model.
 */
export function isChatModel(traits: AgentModelTraits): boolean {
  return (
    (traits.status === undefined || traits.status === "active") &&
    !statesModality(traits.input, "text", false) &&
    !statesModality(traits.output, "text", false) &&
    GENERATED_MEDIA.every(
      (modality) => !statesModality(traits.output, modality, true),
    )
  );
}

/**
 * The global filter for agents: a chat model that also calls tools.
 *
 * @param traits - The model's properties as OpenCode states them.
 * @returns `true` when an agent plan may list the model.
 */
export function isAgentModel(traits: AgentModelTraits): boolean {
  return isChatModel(traits) && traits.toolCall !== false;
}

/**
 * The classification and moderation models PAGE-248 names, by their vendor ID.
 *
 * @remarks
 * No catalog Pages reads states what a model is for: OpenRouter's
 * `/api/v1/models` has no task or purpose field, and OpenCode's capabilities
 * have none either. `openai/gpt-oss-safeguard-20b` states text input and
 * output and the `tools` parameter there (public catalog, 08.11.2026), just
 * like a chat model, so only this exact list keeps it out of the model
 * choice. `meta-llama/llama-guard-4-12b` states no `tools` and is already
 * left out by its facts; it is named as well because the ticket names it.
 * The list holds exact IDs only; Pages guesses no purpose from parts of a
 * name, and the model's stated facts stay as the source states them.
 */
const NAMED_NON_CHAT_MODELS: ReadonlySet<string> = new Set([
  "openai/gpt-oss-safeguard-20b",
  "meta-llama/llama-guard-4-12b",
]);

/**
 * Whether a model ID is one of the classification or moderation models
 * PAGE-248 names, also under the provider prefix of OpenCode.
 *
 * @param modelId - The model ID as the catalog lists it, such as
 * `openai/gpt-oss-safeguard-20b` or `openrouter/openai/gpt-oss-safeguard-20b`.
 * @returns `true` when the ID, or the ID after whole leading provider
 * segments, is exactly a named model.
 */
export function isNamedNonChatModel(modelId: string): boolean {
  const segments = modelId.split("/");
  return segments.some((_, index) =>
    NAMED_NON_CHAT_MODELS.has(segments.slice(index).join("/")),
  );
}

/** What a stored catalog states about a model's modalities and tool calls. */
export interface AgentChatCapabilityFacts {
  /** The model ID as the catalog lists it. */
  readonly id: string;
  /** The input modalities the source states, such as `text` and `image`; absent where it states none. */
  readonly inputModalities?: readonly string[];
  /** The output modalities the source states; absent where it states none. */
  readonly outputModalities?: readonly string[];
  readonly isToolCapable?: boolean;
}

/**
 * Whether a model can chat as an agent or for Pica: it reads and answers in
 * text, generates no image, video or audio, and calls tools.
 *
 * @remarks
 * The facts come from the source and are stored with the catalog: OpenRouter's
 * `architecture` modalities and `supported_parameters`, OpenCode's
 * capabilities. A fact the catalog does not state hides no model, so the
 * models of Claude Code, Codex and Antigravity, whose catalogs state none,
 * always count as chat models. The classification and moderation models the
 * ticket names never count, whatever their facts state
 * ({@link isNamedNonChatModel}).
 *
 * @param model - The stored facts of one catalog model.
 * @returns `false` only when a stated fact rules the model out.
 */
export function isChatCapableModel(model: AgentChatCapabilityFacts): boolean {
  const { inputModalities, outputModalities } = model;
  if (isNamedNonChatModel(model.id)) return false;
  if (inputModalities && !inputModalities.includes("text")) return false;
  if (outputModalities && !outputModalities.includes("text")) return false;
  if (
    outputModalities &&
    GENERATED_MEDIA.some((modality) => outputModalities.includes(modality))
  )
    return false;
  return model.isToolCapable !== false;
}
