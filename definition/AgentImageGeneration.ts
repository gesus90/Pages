/**
 * Contracts of the images an agent generates in a chat with its own model.
 * There is no image model of its own and no setting for one: the
 * model the agent works with in the chat decides whether it can.
 */

/** Limits of one generation. */
export const AGENT_IMAGE_LIMITS = {
  /** Most images one call generates. */
  maximumCount: 4,
  /** Most existing images one call takes as templates. */
  maximumTemplates: 4,
  /** Longest description of the wanted images, in characters. */
  promptCharacters: 4000,
  /** Largest template image, in bytes. */
  templateBytes: 20 * 1024 * 1024,
  /** Largest answer of the provider, in bytes: four images as base64. */
  answerBytes: 96 * 1024 * 1024,
  /** Longest wait for one image, in seconds. */
  timeoutSeconds: 180,
} as const;

/** The aspect ratios a generation may ask for, as the providers name them. */
export const AGENT_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

/** One of {@link AGENT_IMAGE_ASPECT_RATIOS}. */
export type AgentImageAspectRatio = (typeof AGENT_IMAGE_ASPECT_RATIOS)[number];

/** The image types Pages takes from a provider and as a template. */
export const AGENT_IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/**
 * Whether the catalog states that a model outputs images.
 * @remarks
 * Only the stated output modalities decide, never the name of a model:
 * OpenRouter's `architecture.output_modalities` and OpenCode's
 * `capabilities.output`. A catalog that states nothing, as those of Claude
 * Code, Codex and Antigravity, makes no model image capable.
 * @param model - The stored output modalities of a catalog model.
 * @returns `true` when `image` is among them.
 */
export function isImageOutputModel(model: {
  readonly outputModalities?: readonly string[];
}): boolean {
  return model.outputModalities?.includes("image") === true;
}
