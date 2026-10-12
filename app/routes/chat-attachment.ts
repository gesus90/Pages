import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { getApplicationServices } from "@/app/lib/services.server";
import { ChatError } from "@/backend/error/ChatErrors";

import type { Route } from "./+types/chat-attachment";

/** A downloaded attachment runs no script and loads nothing. */
const ATTACHMENT_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

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
      headers: {
        "Cache-Control": "private, no-cache",
        "Content-Disposition": contentDisposition(
          "attachment",
          attachment.fileName,
        ),
        "Content-Length": String(attachment.size),
        "Content-Security-Policy": ATTACHMENT_CONTENT_SECURITY_POLICY,
        "Content-Type": attachment.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    if (error instanceof ChatError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
