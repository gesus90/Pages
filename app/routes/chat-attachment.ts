import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { chatAttachmentDownloadHeaders } from "@/app/lib/chat-attachment-headers";
import { getApplicationServices } from "@/app/lib/services.server";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/chat-attachment";

/**
 * Sends an attachment of an own chat session as a download.
 *
 * @remarks
 * Attachments are never shown inline, so an SVG or HTML source cannot run in
 * the origin of Pages. A foreign and a missing attachment answer alike.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { chatAttachmentService } = await getApplicationServices();
  try {
    const { attachment, stream } = await chatAttachmentService.open(
      actor,
      params.attachmentId,
    );
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: chatAttachmentDownloadHeaders(attachment),
    });
  } catch (error: unknown) {
    logCaughtError("chat_attachment", error);

    if (error instanceof ChatError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
