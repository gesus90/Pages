import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";

import type { Route } from "./+types/chat-page-tool-details";

/**
 * Sends the input and the result of one tool call of a stored answer, which
 * the history of the chat page leaves out until the person opens the call.
 * @remarks
 * `GET /chat-page-api/tool-details?conversation=…&message=…&call=…` reads a
 * call of a stored conversation, `agent=…` instead of `conversation` one of
 * the person's chat session with an agent. The right to read the chat is
 * checked on every request, as for its history; a chat the person may not
 * read answers like a missing call.
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const query = new URL(request.url).searchParams;
  const services = await getApplicationServices();
  try {
    const details = await services.chatDirectoryService.toolDetails(person, {
      conversationId: query.get("conversation"),
      agentId: query.get("agent"),
      messageId: query.get("message"),
      callId: query.get("call"),
    });
    return Response.json(details, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error: unknown) {
    if (!(error instanceof ConversationError)) throw error;
    return error.code === "invalid"
      ? new Response("Bad Request", { status: 400 })
      : new Response("Not Found", { status: 404 });
  }
}
