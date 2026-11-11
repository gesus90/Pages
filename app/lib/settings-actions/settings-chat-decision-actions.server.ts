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
  reasoningEffort: z.string().max(100),
  revision: z.coerce.number().int().nonnegative(),
});

/**
 * Saves the decision model of the instance (PAGE-317).
 *
 * @param context - The administrator in the admin mode and the form.
 * @returns Success; a refused choice throws an {@link AgentError}.
 *
 * @remarks
 * The service checks the administrator, the admin mode and that the model is
 * one of the chat models the instance lists.
 */
export async function saveChatDecisionSettings({
  actor,
  services,
  formData,
}: ChatDecisionActionContext): Promise<{ readonly ok: true }> {
  const form = chatDecisionFormSchema.safeParse({
    modelConnectionId: formData.get("modelConnectionId") ?? "",
    model: formData.get("model") ?? "",
    reasoningEffort: formData.get("reasoningEffort") ?? "",
    revision: formData.get("revision"),
  });
  if (!form.success) throw new AgentError("profile_invalid");
  const { modelConnectionId, model, reasoningEffort, revision } = form.data;
  await services.chatDecisionSettingsService.save(actor, {
    selection:
      modelConnectionId && model
        ? {
            connectionId: modelConnectionId,
            model,
            reasoningEffort: reasoningEffort || null,
          }
        : null,
    revision,
  });
  return { ok: true };
}
