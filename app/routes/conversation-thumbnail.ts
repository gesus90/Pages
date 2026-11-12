import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { conversationFileHead } from "@/app/lib/conversation-file-headers";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/conversation-thumbnail";

/**
 * Sends the preview image of an attachment to a member of its conversation
 * (PAGE-298): `GET /chat/files/<attachmentId>/thumbnail`.
 *
 * @remarks
 * Membership is checked on every request; a missing preview image and one
 * of a conversation the person does not belong to answer 404 alike.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { conversationAttachments } = await getApplicationServices();
  try {
    const opened = await conversationAttachments.open(actor, {
      attachmentId: params.id,
      variant: "thumbnail",
    });
    return new Response(
      Readable.toWeb(opened.stream) as ReadableStream,
      conversationFileHead(opened, false),
    );
  } catch (error: unknown) {
    logCaughtError("conversation_file_thumbnail", error);

    if (error instanceof ConversationError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
