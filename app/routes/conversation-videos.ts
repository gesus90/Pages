import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/conversation-videos";

/**
 * Lists every video of a conversation for a member (PAGE-384):
 * `GET /chat/videos/<conversationId>`, oldest first, with sender, time, the
 * state of each file and its resolution and length, so the split view offers
 * the other videos of the chat and the full screen pages through them, also
 * those of messages the chat has not loaded yet.
 *
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
  const { conversationAttachments } = await getApplicationServices();
  try {
    const videos = await conversationAttachments.videos(actor, params.id);
    return Response.json(
      { videos },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error: unknown) {
    logCaughtError("conversation_videos", error);
    if (error instanceof ConversationError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
