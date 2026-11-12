import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/conversation-link-image";

/**
 * Sends the preview image the server stored for a linked page (PAGE-298):
 * `GET /chat/link-image?url=<url>`.
 *
 * @remarks
 * The image comes from the file store of Pages, so no browser contacts the
 * linked site for a link card. It is sent to signed-in accounts only and
 * runs nothing.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { conversationLinks } = await getApplicationServices();
  try {
    const opened = await conversationLinks.openImage(
      new URL(request.url).searchParams.get("url"),
    );
    return new Response(Readable.toWeb(opened.stream) as ReadableStream, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": opened.mimeType,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    logCaughtError("conversation_link_image", error);

    if (error instanceof ConversationError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
