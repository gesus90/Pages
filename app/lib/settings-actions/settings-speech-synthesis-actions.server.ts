import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { AccountAccess } from "@/definition/Authorization";

/** What the speech output action reads of the checked request. */
interface SpeechSynthesisActionContext {
  readonly actor: AccountAccess;
  readonly services: ApplicationServices;
  readonly formData: FormData;
}

/** The form of the card "Sprachausgabe · TTS"; an empty model clears the choice. */
const speechSynthesisFormSchema = z.object({
  modelConnectionId: z.string().max(100),
  model: z.string().max(500),
  maxDurationMs: z.coerce.number().int(),
  revision: z.coerce.number().int().nonnegative(),
});

/**
 * Saves the speech output setting of the instance (PAGE-300).
 *
 * @param context - The administrator in the admin mode and the form.
 * @returns Success; a refused choice throws an {@link AgentError}.
 *
 * @remarks
 * The service checks the administrator, the admin mode, the duration choice
 * and that the model is a speech output model of the instance.
 */
export async function saveSpeechSynthesisSettings({
  actor,
  services,
  formData,
}: SpeechSynthesisActionContext): Promise<{ readonly ok: true }> {
  const form = speechSynthesisFormSchema.safeParse({
    modelConnectionId: formData.get("modelConnectionId") ?? "",
    model: formData.get("model") ?? "",
    maxDurationMs: formData.get("maxDurationMs"),
    revision: formData.get("revision"),
  });
  if (!form.success) throw new AgentError("profile_invalid");
  const { modelConnectionId, model, maxDurationMs, revision } = form.data;
  await services.speechSynthesisSettingsService.save(actor, {
    selection:
      modelConnectionId && model
        ? { connectionId: modelConnectionId, model }
        : null,
    maxDurationMs,
    revision,
  });
  return { ok: true };
}
