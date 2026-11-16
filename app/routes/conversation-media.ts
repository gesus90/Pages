import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/conversation-media";

/**
 * "Medien & Dateien" of a chat for a member:
 * `GET /chat/media/<conversationId>` lists every file and link of its sent
 * messages, newest first, sorted into tabs, with their senders.
 * @remarks
 * Membership is checked on every request; a conversation the person does not
 * belong to answers like a missing one.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { conversationMediaOverview } = await getApplicationServices();
  try {
    const overview = await conversationMediaOverview.overview(actor, params.id);
    return Response.json(
      { overview },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error: unknown) {
    logCaughtError("conversation_media", error);
    if (error instanceof ConversationError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
