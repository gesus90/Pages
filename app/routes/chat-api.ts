import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  CHAT_NO_STORE,
  chatFailure,
  readChatJson,
  requireChatRequest,
} from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ChatError } from "@/backend/error/ChatErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";
import type { Route } from "./+types/chat-api";

/** Runs one chat intent for the signed-in person; every intent acts on own sessions only. */
async function handleIntent(
  services: ApplicationServices,
  actor: User,
  input: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const sessions = services.chatSessionService;
  switch (input.intent) {
    case "open":
      return { overview: await sessions.open(actor) };
    case "new":
      return { view: await sessions.create(actor) };
    case "sessions":
      return { sessions: await sessions.list(actor) };
    case "session":
      return { view: await sessions.view(actor, input.sessionId) };
    case "send":
      return { reply: await services.chatService.send(actor, input.message) };
    case "delete":
      await sessions.remove(actor, input.sessionId, input.confirmation);
      return {};
    case "discard":
      await services.chatAttachmentService.discard(actor, input.attachmentId);
      return {};
    case "cancel":
      services.chatService.cancel(actor, input.requestId);
      return {};
    default:
      throw new ChatError("invalidInput");
  }
}

/**
 * The JSON interface of the global chat (A11.4): open, `/new`, `/sessions`,
 * switching, sending, `/delete`, discarding an unsent attachment and cancelling.
 *
 * @remarks
 * Only POST requests of the own origin are accepted. Answers are never cached
 * and carry stable error codes instead of messages.
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    requireChatRequest(request, "POST");
    const actor = context.get(authenticatedUserContext);
    if (!actor) throw new ChatError("accessDenied");
    const services = await getApplicationServices();
    const result = await handleIntent(
      services,
      actor,
      await readChatJson(request),
    );
    return Response.json({ ok: true, ...result }, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    return chatFailure(error);
  }
}
