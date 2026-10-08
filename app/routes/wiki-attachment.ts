import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { getApplicationServices } from "@/app/lib/services.server";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import type { Route } from "./+types/wiki-attachment";

/**
 * Policy of every attachment response.
 *
 * @remarks
 * Even a file that is opened by its address runs no script and loads
 * nothing; only an image may show itself.
 */
const ATTACHMENT_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src 'self'; sandbox";

/**
 * Sends an attached file after checking that the person sees its page.
 *
 * @remarks
 * Raster images are shown inline with the type found in their bytes. Every
 * other file, SVG and HTML included, is only ever sent as a download of an
 * unspecific type, with `nosniff` so that no browser guesses a different one.
 * A missing file and a file of a hidden page answer alike.
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

  const { wikiService } = await getApplicationServices();

  try {
    const { attachment, stream } = await wikiService.openAttachment(
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
    if (error instanceof WikiPageNotFoundError) {
      throw new Response("Not Found", { status: 404 });
    }

    throw error;
  }
}
