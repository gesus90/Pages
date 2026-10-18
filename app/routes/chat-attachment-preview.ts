import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { getApplicationServices } from "@/app/lib/services.server";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/chat-attachment-preview";

/**
 * A shown image runs no script and loads nothing; inline styles of a checked
 * SVG stay, everything else is refused, also when the URL is opened directly.
 */
const PREVIEW_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Sends an image of an own chat session to be shown as a thumbnail (PAGE-92).
 *
 * @remarks
 * Only images pass: raster images and SVG files that passed the safety check
 * at the upload. Every other type, a foreign and a missing attachment answer
 * alike with 404. The browser may keep the image only privately and asks
 * again each time, so a deleted session takes its images with it.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { chatAttachmentService } = await getApplicationServices();
  try {
    const { attachment, stream } = await chatAttachmentService.openImage(
      actor,
      params.attachmentId,
    );
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Cache-Control": "private, no-cache",
        "Content-Disposition": contentDisposition(
          "inline",
          attachment.fileName,
        ),
        "Content-Length": String(attachment.size),
        "Content-Security-Policy": PREVIEW_CONTENT_SECURITY_POLICY,
        "Content-Type": attachment.contentType,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    logCaughtError("chat_attachment_preview", error);

    if (error instanceof ChatError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
