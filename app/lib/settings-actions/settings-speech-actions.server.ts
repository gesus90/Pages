import { readText, readTextOrEmpty } from "@/app/lib/form-fields.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { SPEECH_MAXIMUM_BYTES } from "@/definition/SpeechRecognition";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { AccountAccess } from "@/definition/Authorization";
import type { SpeechTestOutcome } from "@/definition/SpeechRecognition";

/** What a speech action reads of the checked request. */
interface SpeechActionContext {
  readonly actor: AccountAccess;
  readonly services: ApplicationServices;
  readonly formData: FormData;
}

/**
 * Saves the speech recognition setting of the instance (PAGE-273).
 *
 * @param context - The administrator in the admin mode and the form.
 * @returns Success; a refused choice throws an {@link AgentError}.
 */
export async function saveSpeechSettings({
  actor,
  services,
  formData,
}: SpeechActionContext): Promise<{ readonly ok: true }> {
  const connectionId = readTextOrEmpty(formData, "modelConnectionId");
  const model = readTextOrEmpty(formData, "model");
  const maxDurationMs = Number(readText(formData, "maxDurationMs"));
  const revision = Number(readText(formData, "revision"));
  if (
    connectionId.length > 100 ||
    model.length > 500 ||
    !Number.isSafeInteger(revision)
  )
    throw new AgentError("profile_invalid");
  await services.speechSettingsService.save(actor, {
    selection: connectionId && model ? { connectionId, model } : null,
    maxDurationMs,
    revision,
  });
  return { ok: true };
}

/**
 * Recognizes a test recording of the settings card with the saved setting.
 *
 * @param context - The administrator in the admin mode and the form with the
 * recording as the file `audio`.
 * @returns The recognized text or the code of why there is none.
 *
 * @remarks
 * The recording is read into memory, recognized and cleared; it is neither
 * stored nor logged.
 */
export async function testSpeechRecognition({
  services,
  formData,
}: SpeechActionContext): Promise<{
  readonly ok: true;
  readonly speech: SpeechTestOutcome;
}> {
  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) throw new AgentError("profile_invalid");
  if (audio.size > SPEECH_MAXIMUM_BYTES)
    return { ok: true, speech: { ok: false, code: "too_large" } };
  const speech = await services.speechRecognitionService.transcribe({
    audio: Buffer.from(await audio.arrayBuffer()),
    mimeType: audio.type,
    signal: AbortSignal.timeout(120_000),
  });
  return { ok: true, speech };
}
