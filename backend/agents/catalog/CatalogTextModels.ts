import { readAgentObject } from "@/backend/agents/AgentPayload";
import { isTranscriptionModel } from "@/definition/SpeechRecognition";

import type { ApiProviderId } from "@/definition/AgentConnection";

function listsValue(list: unknown, value: string): boolean {
  return Array.isArray(list) && list.includes(value);
}

function listsOnly(list: unknown, value: string): boolean {
  return Array.isArray(list) && list.length === 1 && list[0] === value;
}

function statedModalities(list: unknown): readonly string[] {
  return Array.isArray(list)
    ? list.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Tells whether a listed model reads and writes text, by the catalog's own data.
 *
 * @param entry - One raw model entry of a provider listing.
 * @param provider - The provider that listed the entry.
 * @returns `true` when the entry belongs in a text catalog.
 *
 * @remarks
 * - OpenRouter states `architecture.input_modalities` and `output_modalities`;
 *   a text model accepts text and outputs only text, so image, audio, video,
 *   speech, embedding, rerank and decision models stay out.
 * - Google states `supportedGenerationMethods`; Pages generates text through
 *   `generateContent`, so embedding, Imagen, Veo and answer-only models stay out.
 * - OpenAI, Anthropic and Z.AI listings carry no modality data, so no entry is
 *   removed by guessing from its name.
 */
export function isTextModel(entry: unknown, provider: ApiProviderId): boolean {
  const model = readAgentObject(entry);
  if (provider === "openrouter") {
    const architecture = readAgentObject(model.architecture);
    return (
      listsValue(architecture.input_modalities, "text") &&
      listsOnly(architecture.output_modalities, "text")
    );
  }
  if (provider === "google_ai_studio")
    return listsValue(model.supportedGenerationMethods, "generateContent");
  return true;
}

/**
 * Tells whether a listed model transcribes speech, by the catalog's own data (PAGE-294).
 *
 * @param entry - One raw model entry of a provider listing.
 * @param provider - The provider that listed the entry.
 * @returns `true` for an OpenRouter model that states audio input and
 * `transcription` output ({@link isTranscriptionModel}).
 *
 * @remarks
 * Only OpenRouter states modalities. A transcription model reads no text and
 * writes no chat answer, so it is kept for the speech recognition alone: its
 * stored modalities rule out chatting, and Pica, agents and plan nodes still
 * leave it out. A chat model that also accepts audio stays a text model.
 */
export function isSpeechModel(
  entry: unknown,
  provider: ApiProviderId,
): boolean {
  if (provider !== "openrouter") return false;
  const architecture = readAgentObject(readAgentObject(entry).architecture);
  return isTranscriptionModel({
    inputModalities: statedModalities(architecture.input_modalities),
    outputModalities: statedModalities(architecture.output_modalities),
  });
}

/**
 * Tells whether a listed model belongs in the shared catalog: a text model
 * or a transcription model.
 *
 * @param entry - One raw model entry of a provider listing.
 * @param provider - The provider that listed the entry.
 * @returns `true` when {@link isTextModel} or {@link isSpeechModel} keeps it.
 */
export function isCatalogModel(
  entry: unknown,
  provider: ApiProviderId,
): boolean {
  return isTextModel(entry, provider) || isSpeechModel(entry, provider);
}
