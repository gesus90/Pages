import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

/** What the Z.AI documentation states for one model, kept only where the adapter confirms it. */
export interface DocumentedZaiModel {
  readonly contextWindow: number;
  /** Selectable `reasoning_effort` values, lowest first. */
  readonly efforts: readonly string[];
  /** The effort Z.AI applies when a request names none. */
  readonly defaultEffort: string;
  readonly supportsImages: boolean;
}

// GLM 5.3 documents `thinking.type: enabled` as its only mode and the
// `reasoning_effort` values `low`, `high` and `max` with `max` as the default
// (https://docs.z.ai/guides/llm/glm-5.3.md, retrieved 2026-11-19). It lists a
// 1M-token window and text input. GLM 5.3 Flash and FlashX share its text
// parameters and add image, video and file input
// (https://docs.z.ai/guides/vlm/glm-5.3-flash.md, retrieved 2026-11-19).
// OpenCode 1.18.34, which runs these models for plan nodes, lists exactly
// the variants `low`, `high` and `max` for each of them on `zai` and
// `zai-coding-plan`, and a request with the variant `high` or `max` carried
// `reasoning_effort: high` or `max`. `medium` is no variant: the request then
// carries no `reasoning_effort`, so it is neither documented nor offered.
const GLM_5_3_TEXT: DocumentedZaiModel = {
  contextWindow: 1_000_000,
  efforts: ["low", "high", "max"],
  defaultEffort: "max",
  supportsImages: false,
};

const GLM_5_3_MULTIMODAL: DocumentedZaiModel = {
  ...GLM_5_3_TEXT,
  supportsImages: true,
};

const DOCUMENTED_ZAI_MODELS: Readonly<Record<string, DocumentedZaiModel>> = {
  "glm-5.3": GLM_5_3_TEXT,
  "glm-5.3-flash": GLM_5_3_MULTIMODAL,
  "glm-5.3-flashx": GLM_5_3_MULTIMODAL,
};

/**
 * The documented capabilities of a Z.AI model.
 * @param id - The model ID the Z.AI model listing states.
 * @returns The documented facts, or `null` for a model the documentation does
 * not describe; nothing is derived from a display name.
 */
export function documentedZaiModel(id: string): DocumentedZaiModel | null {
  return Object.hasOwn(DOCUMENTED_ZAI_MODELS, id)
    ? DOCUMENTED_ZAI_MODELS[id]
    : null;
}

/**
 * Fills the capabilities the Z.AI listing leaves out from the documentation.
 * @param model - A model of a Z.AI catalog.
 * @returns The model with its context window, reasoning levels, image input
 * and tool calls added where it states none; a value the entry states stays.
 * @remarks
 * The Z.AI listing carries the model ID only, so without this a model has no
 * context window and offers no reasoning level. Only a model of the
 * documentation gets facts; every other entry stays as the listing gave it.
 */
export function withDocumentedZaiCapabilities(
  model: AgentCatalogModel,
): AgentCatalogModel {
  const documented = documentedZaiModel(model.id);
  if (documented === null) return model;
  const documentedReasoning: Pick<
    AgentCatalogModel,
    "reasoning" | "reasoningEfforts" | "defaultReasoningEffort"
  > = {
    reasoning: "levels",
    reasoningEfforts: documented.efforts,
    defaultReasoningEffort: documented.defaultEffort,
  };
  return {
    ...model,
    contextWindow: model.contextWindow ?? documented.contextWindow,
    supportsImages: model.supportsImages ?? documented.supportsImages,
    isToolCapable: model.isToolCapable ?? true,
    ...(model.reasoning === "levels" ? {} : documentedReasoning),
  };
}
