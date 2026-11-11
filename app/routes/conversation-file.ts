import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  conversationFileHead,
  readByteRange,
} from "@/app/lib/conversation-file-headers";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/conversation-file";

/** A range no file can be this large for; the service cuts it to the file. */
const OPEN_END = Number.MAX_SAFE_INTEGER;

/**
 * Sends the original of an attachment to a member of its conversation
 * (PAGE-298): `GET /chat/files/<attachmentId>`, with `?download=1` as a
 * download.
 *
 * @remarks
 * Membership is checked on every request, so leaving a conversation ends
 * the access; a file of a conversation the person does not belong to answers
 * like a missing one. The file streams, and a `Range` header answers the
 * asked part with 206, so video and audio can seek.
 */
export async function loader({
  context,
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { conversationAttachments } = await getApplicationServices();
  try {
    const opened = await conversationAttachments.open(actor, {
      attachmentId: params.id,
      variant: "original",
      range: readByteRange(request.headers.get("range"), OPEN_END),
    });
    const head = conversationFileHead(
      opened,
      new URL(request.url).searchParams.get("download") === "1",
    );
    return new Response(Readable.toWeb(opened.stream) as ReadableStream, head);
  } catch (error: unknown) {
    logCaughtError("conversation_file", error);

    if (error instanceof ConversationError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
