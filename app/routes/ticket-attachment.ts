import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { getApplicationServices } from "@/app/lib/services.server";
import { describeTicketUploadFailure } from "@/app/lib/task-actions/ticket-upload.server";

import type { Route } from "./+types/ticket-attachment";

/** Even a file opened by its address runs no script; only an image shows itself. */
const ATTACHMENT_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src 'self'; sandbox";

/**
 * Sends a file attached to a ticket after checking that the person sees the
 * ticket (A8.2-E06).
 *
 * @remarks
 * The same rules as for wiki attachments: raster images inline with the type
 * found in their bytes, everything else only as a download of an unspecific
 * type with `nosniff`. A missing file and a file of a hidden ticket answer alike.
 */
export async function loader({
  context,
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Response("Forbidden", { status: 403 });
  }

  const { taskAttachmentService } = await getApplicationServices();

  try {
    const { attachment, stream } = await taskAttachmentService.open(
      actor,
      params.attachmentId,
    );
    const isInline =
      attachment.isEmbeddable &&
      new URL(request.url).searchParams.get("download") !== "1";

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Cache-Control": "private, no-cache",
        "Content-Disposition": contentDisposition(
          isInline ? "inline" : "attachment",
          attachment.fileName,
        ),
        "Content-Length": String(attachment.size),
        "Content-Security-Policy": ATTACHMENT_CONTENT_SECURITY_POLICY,
        "Content-Type": attachment.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    if (describeTicketUploadFailure(error)?.status === 404) {
      throw new Response("Not Found", { status: 404 });
    }

    throw error;
  }
}
