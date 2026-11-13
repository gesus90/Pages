import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { AccountAccess } from "@/definition/Authorization";

/** What the decision model action reads of the checked request. */
interface ChatDecisionActionContext {
  readonly actor: AccountAccess;
  readonly services: ApplicationServices;
  readonly formData: FormData;
}

/** The form of the card "Entscheidungen in Chats"; an empty model clears the choice. */
const chatDecisionFormSchema = z.object({
  modelConnectionId: z.string().max(100),
  model: z.string().max(500),
  answerThreshold: z.coerce.number().int(),
  responsibilityThreshold: z.coerce.number().int(),
  secondThreshold: z.coerce.number().int(),
  maximumResponders: z.coerce.number().int(),
  revision: z.coerce.number().int().nonnegative(),
});

/**
 * Saves the decision model and the default thresholds of the instance
 * (PAGE-317, PAGE-379).
 *
 * @param context - The administrator in the admin mode and the form.
 * @returns Success; a refused choice throws an {@link AgentError}.
 *
 * @remarks
 * The service checks the administrator, the admin mode, that the model is
 * one of the decision models the instance lists and that the thresholds are
 * whole percents in range.
 */
export async function saveChatDecisionSettings({
  actor,
  services,
  formData,
}: ChatDecisionActionContext): Promise<{ readonly ok: true }> {
  const form = chatDecisionFormSchema.safeParse({
    modelConnectionId: formData.get("modelConnectionId") ?? "",
    model: formData.get("model") ?? "",
    answerThreshold: formData.get("answerThreshold"),
    responsibilityThreshold: formData.get("responsibilityThreshold"),
    secondThreshold: formData.get("secondThreshold"),
    maximumResponders: formData.get("maximumResponders"),
    revision: formData.get("revision"),
  });
  if (!form.success) throw new AgentError("profile_invalid");
  const { modelConnectionId, model, revision, ...rules } = form.data;
  await services.chatDecisionSettingsService.save(actor, {
    selection:
      modelConnectionId && model
        ? { connectionId: modelConnectionId, model, reasoningEffort: null }
        : null,
    rules,
    revision,
  });
  return { ok: true };
}
