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
  /** OpenCode's `capabilities.output` modalities. */
  readonly output: unknown;
  /** OpenCode's `capabilities.toolcall`. */
  readonly toolCall: unknown;
}

const GENERATED_MEDIA = ["image", "video", "audio"] as const;

function statesModality(
  output: unknown,
  modality: string,
  stated: boolean,
): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    Reflect.get(output, modality) === stated
  );
}

/**
 * The global filter for every chat model choice: an active language model
 * that answers in text and generates no image, video or audio.
 *
 * @param traits - The model's properties as OpenCode states them.
 * @returns `true` when Pica and plans may list the model.
 */
export function isChatModel(traits: AgentModelTraits): boolean {
  return (
    (traits.status === undefined || traits.status === "active") &&
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
