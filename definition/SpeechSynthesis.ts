import type { AgentCatalogModel } from "./AgentModelCatalog";
import type { PageAgentModel } from "./PageAgent";
import type { SpeechModelSelection } from "./SpeechRecognition";

/**
 * The choices of the longest output, in milliseconds: 30 seconds and 1, 2,
 * 3, 5 and 10 minutes.
 */
export const SPEECH_SYNTHESIS_DURATION_CHOICES = [
  30_000, 60_000, 120_000, 180_000, 300_000, 600_000,
] as const;

/** One choice of the longest output. */
export type SpeechSynthesisDurationChoice =
  (typeof SPEECH_SYNTHESIS_DURATION_CHOICES)[number];

/** The longest output of an instance that chose none. */
export const SPEECH_SYNTHESIS_DEFAULT_DURATION_MS: SpeechSynthesisDurationChoice = 120_000;

/** The speed range of an agent's voice, in tenths: 0.5× to 2.0× in steps of 0.1. */
export const AGENT_VOICE_SPEED = {
  minimumTenths: 5,
  maximumTenths: 20,
  defaultTenths: 10,
} as const;

/** The longest voice ID Pages keeps. */
export const AGENT_VOICE_ID_MAXIMUM = 100;

/** The header of a voice sample that names the rate the player applies itself. */
export const VOICE_PLAYBACK_RATE_HEADER = "X-Pages-Playback-Rate";

/** The languages of the fixed sample sentence. */
export const AGENT_VOICE_SAMPLE_LANGUAGES = ["de", "en"] as const;

/** One language of {@link AGENT_VOICE_SAMPLE_LANGUAGES}. */
export type AgentVoiceSampleLanguage =
  (typeof AGENT_VOICE_SAMPLE_LANGUAGES)[number];

/** The fixed sample sentences; only the agent's stored name is filled in. */
const SAMPLE_SENTENCES: Readonly<Record<AgentVoiceSampleLanguage, string>> = {
  de: "Hallo, ich bin {name}. So klinge ich in Pages.",
  en: "Hello, I am {name}. This is how I sound in Pages.",
};

/** The stored speech output setting of the instance (PAGE-300). */
export interface SpeechSynthesisSettings {
  /** `null` while no model is chosen; no agent has a voice then. */
  readonly selection: SpeechModelSelection | null;
  readonly maxDurationMs: SpeechSynthesisDurationChoice;
  readonly revision: number;
}

/**
 * Whether the speech output can run.
 *
 * - `ready`: the chosen model is one of the listed speech output models.
 * - `noModel`: no model is chosen.
 * - `modelUnavailable`: the chosen model is no longer in the catalog of a
 *   usable connection.
 */
export type SpeechSynthesisStatus = "ready" | "noModel" | "modelUnavailable";

/** What the settings card "Sprachausgabe · TTS" shows and edits. */
export interface SpeechSynthesisAdministration {
  readonly settings: SpeechSynthesisSettings;
  readonly status: SpeechSynthesisStatus;
  /** The speech output models of the instance for the shared model choice. */
  readonly models: readonly PageAgentModel[];
  /** Whether the development simulation answers instead of a provider. */
  readonly isSimulation: boolean;
}

/** The speech output model of the instance as the voice tab of an agent names it. */
export interface AgentVoiceModel {
  readonly connectionId: string;
  readonly model: string;
  /** The catalog name of the model, such as "Gemini 3.8 Flash TTS". */
  readonly name: string;
  /**
   * The voice IDs the catalog lists for the model, in its order; `null`
   * when it lists none, so the tab asks for a voice ID instead.
   */
  readonly voices: readonly string[] | null;
}

/** What the voice tab of the agent panel offers (PAGE-300). */
export interface AgentVoiceOptions {
  readonly status: SpeechSynthesisStatus;
  /** The model of the instance; `null` unless the status is `ready`. */
  readonly model: AgentVoiceModel | null;
}

/** The voice and speed an agent has saved. */
export interface AgentEmployeeVoice {
  /** The chosen voice ID; `null` while the agent uses the model's first voice. */
  readonly voiceId: string | null;
  /** The speed in tenths, from 5 (0.5×) to 20 (2.0×). */
  readonly speedTenths: number;
}

/** The voice that applies to an agent with the instance's model. */
export interface EffectiveAgentVoice {
  /** The voice that speaks; `null` when the model lists no voice and none is saved. */
  readonly voiceId: string | null;
  /** The saved voice when the model's list does not hold it; it stays saved. */
  readonly missingVoiceId: string | null;
}

/**
 * Whether a catalog model is a speech output (text-to-speech) model (PAGE-300).
 *
 * @param model - The modalities its catalog states.
 * @returns `true` only when the catalog states `speech` among the outputs.
 *
 * @remarks
 * OpenRouter lists these models only under `output_modalities=speech` and
 * runs them through `POST /api/v1/audio/speech`
 * (https://openrouter.ai/docs/guides/overview/multimodal/tts). A model whose
 * catalog states no modalities never counts as one.
 */
export function isSpeechSynthesisModel(
  model: Pick<AgentCatalogModel, "outputModalities">,
): boolean {
  return model.outputModalities?.includes("speech") === true;
}

/**
 * Whether a number is one of the choices of the longest output.
 *
 * @param value - A submitted or stored number of milliseconds.
 */
export function isSpeechSynthesisDurationChoice(
  value: number,
): value is SpeechSynthesisDurationChoice {
  return SPEECH_SYNTHESIS_DURATION_CHOICES.some((choice) => choice === value);
}

/**
 * Whether a number is a speed of an agent's voice in tenths.
 *
 * @param value - A submitted or stored number.
 */
export function isAgentVoiceSpeed(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= AGENT_VOICE_SPEED.minimumTenths &&
    value <= AGENT_VOICE_SPEED.maximumTenths
  );
}

/**
 * The voice that applies to an agent.
 *
 * @param voices - The voices of the instance's model; `null` without a list.
 * @param saved - The agent's saved voice ID; `null` without one.
 * @returns The saved voice when the model offers it, otherwise the model's
 * first voice, with the saved voice the model lacks.
 *
 * @remarks
 * Without a list the saved voice ID is used as it is, since the model's
 * catalog cannot say whether it knows it.
 */
export function effectiveAgentVoice(
  voices: readonly string[] | null,
  saved: string | null,
): EffectiveAgentVoice {
  if (voices === null) return { voiceId: saved, missingVoiceId: null };
  if (saved !== null && voices.includes(saved))
    return { voiceId: saved, missingVoiceId: null };
  return { voiceId: voices[0] ?? null, missingVoiceId: saved };
}

/**
 * The fixed sample sentence of an agent's voice.
 *
 * @param name - The agent's stored display name.
 * @param language - The language of the sentence.
 * @returns For example "Hallo, ich bin All Might. So klinge ich in Pages."
 */
export function agentVoiceSampleText(
  name: string,
  language: AgentVoiceSampleLanguage,
): string {
  return SAMPLE_SENTENCES[language].replace("{name}", name);
}
