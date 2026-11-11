import type { AgentCatalogModel } from "./AgentModelCatalog";
import type { PageAgentModel } from "./PageAgent";

/** The choices of the longest recording, in milliseconds: 1, 2 and 5 minutes. */
export const SPEECH_DURATION_CHOICES = [60_000, 120_000, 300_000] as const;

/** One choice of the longest recording. */
export type SpeechDurationChoice = (typeof SPEECH_DURATION_CHOICES)[number];

/** The longest recording of an instance that chose none. */
export const SPEECH_DEFAULT_DURATION_MS: SpeechDurationChoice = 120_000;

/** The largest recording Pages accepts, whatever the model: 25 MB. */
export const SPEECH_MAXIMUM_BYTES = 25 * 1024 * 1024;

/**
 * The audio formats Pages passes on unchanged.
 *
 * @remarks
 * WAV and MP3 are the formats both connected providers accept: the
 * transcription API of OpenRouter takes `wav` and `mp3`, Z.AI's transcription
 * `.wav` and `.mp3`. Pages converts no audio.
 */
export const SPEECH_MIME_TYPES = ["audio/wav", "audio/mpeg"] as const;

/** One audio format of {@link SPEECH_MIME_TYPES}. */
export type SpeechMimeType = (typeof SPEECH_MIME_TYPES)[number];

/** Why a recognition gives no text; the same codes on the web and in `speech_error`. */
export const SPEECH_ERROR_CODES = [
  "not_configured",
  "too_large",
  "too_long",
  "unsupported_format",
  "invalid_sequence",
  "provider_failed",
  "provider_unreachable",
] as const;

/** One reason of {@link SPEECH_ERROR_CODES}. */
export type SpeechErrorCode = (typeof SPEECH_ERROR_CODES)[number];

/** The model the instance recognizes speech with. */
export interface SpeechModelSelection {
  readonly connectionId: string;
  readonly model: string;
}

/** The stored speech recognition setting of the instance. */
export interface SpeechSettings {
  /** `null` while no model is chosen; speech recognition is off then. */
  readonly selection: SpeechModelSelection | null;
  readonly maxDurationMs: SpeechDurationChoice;
  readonly revision: number;
}

/**
 * Whether speech recognition can run.
 *
 * - `ready`: the chosen model is one of the listed speech models.
 * - `noModel`: no model is chosen.
 * - `modelUnavailable`: the chosen model is no longer offered, for example
 *   because its connection was removed or switched off.
 * - `modelUnsuitable`: the catalog of the chosen model's connection still
 *   lists it, but not as a transcription model ({@link isTranscriptionModel}),
 *   such as a chat model that also accepts audio (PAGE-294).
 * - `modelNotInCatalog`: the chosen model's OpenRouter connection is usable,
 *   but its catalog no longer lists the model (PAGE-302). Nothing switches
 *   to another model.
 */
export type SpeechStatus =
  | "ready"
  | "noModel"
  | "modelUnavailable"
  | "modelUnsuitable"
  | "modelNotInCatalog";

/** What the settings card shows and edits. */
export interface SpeechAdministration {
  readonly settings: SpeechSettings;
  readonly status: SpeechStatus;
  /** The speech models of the instance for the shared model choice. */
  readonly models: readonly PageAgentModel[];
  /** The stated longest recording of a model, by the model's selection key; absent where none is stated. */
  readonly modelLimits: Readonly<Record<string, number>>;
  /** The longest recording that applies now: the setting, or the shorter limit of the model. */
  readonly effectiveMaxDurationMs: number;
  /** Whether the development simulation answers instead of a provider. */
  readonly isSimulation: boolean;
}

/** What a test recording on the settings card gave. */
export type SpeechTestOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: SpeechErrorCode };

/**
 * Whether a catalog model is a speech-to-text model (PAGE-294).
 *
 * @param model - The modalities its catalog states.
 * @returns `true` only when the catalog states audio among the inputs and
 * `transcription` among the outputs.
 *
 * @remarks
 * This is OpenRouter's documented capability of the models its
 * `/audio/transcriptions` endpoint runs
 * (https://openrouter.ai/docs/guides/overview/multimodal/stt). A chat model
 * that accepts audio and answers in text is no transcription model, and a
 * model whose catalog states no modalities never counts as one.
 */
export function isTranscriptionModel(
  model: Pick<AgentCatalogModel, "inputModalities" | "outputModalities">,
): boolean {
  return (
    model.inputModalities?.includes("audio") === true &&
    model.outputModalities?.includes("transcription") === true
  );
}

/**
 * Whether a number is one of the choices of the longest recording.
 *
 * @param value - A submitted or stored number of milliseconds.
 * @returns `true` for 60000, 120000 and 300000.
 */
export function isSpeechDurationChoice(
  value: number,
): value is SpeechDurationChoice {
  return SPEECH_DURATION_CHOICES.some((choice) => choice === value);
}

const MIME_ALIASES: Readonly<Record<string, SpeechMimeType>> = {
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
};

/**
 * Reads the audio format of a declared MIME type.
 *
 * @param value - The declared type, such as `audio/wav` or `audio/mpeg;
 * codecs=mp3`.
 * @returns The format, or `null` for every other type.
 */
export function readSpeechMimeType(value: string): SpeechMimeType | null {
  const [type = ""] = value.split(";");
  return MIME_ALIASES[type.trim().toLowerCase()] ?? null;
}

/**
 * The longest recording that applies.
 *
 * @param maxDurationMs - The administrator's choice.
 * @param modelLimitMs - The limit the model states; `null` without one.
 * @returns The shorter of both.
 */
export function effectiveSpeechDuration(
  maxDurationMs: number,
  modelLimitMs: number | null,
): number {
  return modelLimitMs === null
    ? maxDurationMs
    : Math.min(maxDurationMs, modelLimitMs);
}
