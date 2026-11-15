/**
 * Contracts of the videos and sounds an agent generates in a chat with its
 * own model (PAGE-384). As for images (PAGE-382) there is no video or audio
 * model of its own and no setting for one: the model the agent works with in
 * the chat decides whether it can.
 */

/** What an agent generates besides images. */
export type AgentMediaKind = "video" | "audio";

/** Limits of one generation. */
export const AGENT_MEDIA_LIMITS = {
  /** Longest description of the wanted video or sound, in characters. */
  promptCharacters: 4000,
  /** Largest answer of the provider, in bytes. */
  answerBytes: 256 * 1024 * 1024,
  /** Longest wait for one video, in seconds: video models take minutes. */
  videoTimeoutSeconds: 600,
  /** Longest wait for one sound, in seconds. */
  audioTimeoutSeconds: 180,
  /** Pause between two looks at a running video generation, in milliseconds. */
  pollMilliseconds: 10_000,
  /** Shortest and longest video an agent asks for, in seconds. */
  videoSeconds: { minimum: 4, maximum: 8 },
} as const;

/** The aspect ratios a video may ask for, as the providers name them. */
export const AGENT_VIDEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;

/** One of {@link AGENT_VIDEO_ASPECT_RATIOS}. */
export type AgentVideoAspectRatio = (typeof AGENT_VIDEO_ASPECT_RATIOS)[number];

/** The video types Pages takes from a provider, with the extension of the stored file. */
export const AGENT_VIDEO_MIME_TYPES: Readonly<Record<string, string>> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

/** The audio types Pages takes from a provider, with the extension of the stored file. */
export const AGENT_AUDIO_MIME_TYPES: Readonly<Record<string, string>> = {
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "audio/flac": ".flac",
  "audio/aac": ".aac",
};

/**
 * The stored types of one kind.
 *
 * @param kind - Video or audio.
 */
export function agentMediaMimeTypes(
  kind: AgentMediaKind,
): Readonly<Record<string, string>> {
  return kind === "video" ? AGENT_VIDEO_MIME_TYPES : AGENT_AUDIO_MIME_TYPES;
}

/**
 * Whether the catalog states that a model outputs video or audio.
 *
 * @remarks
 * Only the stated output modalities decide, never the name of a model:
 * OpenRouter's `architecture.output_modalities` and OpenCode's
 * `capabilities.output`. A catalog that states nothing, as those of Claude
 * Code, Codex and Antigravity, makes no model capable. `speech` of the speech
 * output models (PAGE-300) does not count: those models do not chat.
 *
 * @param model - The stored output modalities of a catalog model.
 * @param kind - Video or audio.
 * @returns `true` when the kind is among them.
 */
export function isMediaOutputModel(
  model: { readonly outputModalities?: readonly string[] },
  kind: AgentMediaKind,
): boolean {
  return model.outputModalities?.includes(kind) === true;
}
