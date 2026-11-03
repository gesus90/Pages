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
