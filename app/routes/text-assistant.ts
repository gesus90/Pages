import { readAgentObject } from "@/backend/agents/AgentPayload";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import {
  readAssistantContext,
  readAssistantIdentifier,
} from "@/backend/service/assistant/TextAssistantValidation";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  ASSISTANT_NO_STORE,
  textAssistantFailure,
} from "@/app/lib/text-assistant-response.server";

import type { Route } from "./+types/text-assistant";

/** Only explicit POST actions can create conversations, generate text or save preferences. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST") throw new TextAssistantError("invalidInput");
    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== new URL(request.url).origin)
      throw new TextAssistantError("accessDenied");
    const user = context.get(authenticatedUserContext);
    if (!user) throw new TextAssistantError("accessDenied");
    const services = await getApplicationServices();
    const account = await services.administrationService.getContext(user.id);
    if (!account.isActive) throw new TextAssistantError("accessDenied");
    const content = await request.text();
    if (content.length > 500_000) throw new TextAssistantError("invalidInput");
    const parsed: unknown = JSON.parse(content);
    const input = readAgentObject(parsed);
    const assistant = services.textAssistantService;
    switch (input.intent) {
      case "run":
        return Response.json(
          { ok: true, result: await assistant.run(user, input.request) },
          { headers: ASSISTANT_NO_STORE },
        );
      case "validate":
        await assistant.validate(user, input.request);
        break;
      case "history":
        return Response.json(
          { ok: true, ...(await assistant.history(user, input.context)) },
          { headers: ASSISTANT_NO_STORE },
        );
      case "messages":
        return Response.json(
          {
            ok: true,
            messages: await assistant.messages(
              user,
              readAssistantContext(input.context),
              readAssistantIdentifier(input.id),
            ),
          },
          { headers: ASSISTANT_NO_STORE },
        );
      case "delete":
        await assistant.remove(user, readAssistantIdentifier(input.id));
        break;
      case "preferences":
        await assistant.savePreferences(user, input.preferences);
        break;
      case "cancel":
        assistant.cancel(user, readAssistantIdentifier(input.id));
        break;
      default:
        throw new TextAssistantError("invalidInput");
    }
    return Response.json({ ok: true }, { headers: ASSISTANT_NO_STORE });
  } catch (error: unknown) {
    return textAssistantFailure(error);
  }
}
