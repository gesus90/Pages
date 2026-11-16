import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/conversation-images";

/**
 * Lists every image of a conversation for a member:
 * `GET /chat/images/<conversationId>`, oldest first, with sender, time and
 * the state of each file, so the image viewer pages through the images of
 * messages the chat has not loaded yet.
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
    const images = await conversationAttachments.images(actor, params.id);
    return Response.json(
      { images },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error: unknown) {
    logCaughtError("conversation_images", error);
    if (error instanceof ConversationError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
