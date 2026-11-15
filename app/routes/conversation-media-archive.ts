import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  archiveSize,
  zipArchive,
} from "@/backend/service/conversation/content/ConversationZipArchive";

import type { Route } from "./+types/conversation-media-archive";

/** The answer to each refusal of the overview service. */
function refusalOf(error: ConversationError): Response {
  return error.code === "invalid"
    ? new Response("Bad Request", { status: 400 })
    : new Response("Not Found", { status: 404 });
}

/**
 * Sends the files a member chose in "Medien & Dateien" as one ZIP archive
 * (PAGE-387): `GET /chat/media/<conversationId>/files.zip?ids=<id>,<id>`.
 *
 * @remarks
 * Membership is checked on every request; a conversation the person does not
 * belong to answers like a missing one. Expired files are left out; the
 * archive streams without compression and keeps names and formats.
 */
export async function loader({
  context,
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { conversationMediaOverview } = await getApplicationServices();
  try {
    const { entries } = await conversationMediaOverview.archive(actor, {
      conversationId: params.id,
      ids: new URL(request.url).searchParams.get("ids"),
    });
    const size = archiveSize(entries);
    if (size > 0xffffffff) throw new Response("Too Large", { status: 413 });
    const stream = Readable.from(zipArchive(entries, new Date()));
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-cache",
        "Content-Disposition": contentDisposition(
          "attachment",
          `chat-medien-${params.id.slice(0, 8)}.zip`,
        ),
        "Content-Length": String(size),
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    logCaughtError("conversation_media_archive", error);
    if (error instanceof ConversationError) throw refusalOf(error);
    throw error;
  }
}
