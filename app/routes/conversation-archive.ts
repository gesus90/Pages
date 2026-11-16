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

import type { Route } from "./+types/conversation-archive";

/**
 * Sends every file of a message that is still there as one ZIP archive to a
 * member of its conversation: `GET /chat/messages/<messageId>/files.zip`,
 * "Alle herunterladen" of a gallery.
 * @remarks
 * Membership is checked on every request; a message of a conversation the
 * person does not belong to answers like a missing one. The files keep
 * their names and formats; the archive streams without compression.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { conversationAttachments } = await getApplicationServices();
  try {
    const { entries } = await conversationAttachments.archive(actor, params.id);
    const size = archiveSize(entries);
    if (size > 0xffffffff) throw new Response("Too Large", { status: 413 });
    const stream = Readable.from(zipArchive(entries, new Date()));
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-cache",
        "Content-Disposition": contentDisposition(
          "attachment",
          `chat-dateien-${params.id.slice(0, 8)}.zip`,
        ),
        "Content-Length": String(size),
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    logCaughtError("conversation_archive", error);
    if (error instanceof ConversationError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
