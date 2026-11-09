import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { conversationVoiceHeaders } from "@/app/lib/conversation-voice-headers";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/conversation-voice";

/**
 * Sends the audio of a voice message to a member of its conversation (PAGE-278).
 *
 * @remarks
 * Membership is checked on every request; a message of a conversation the
 * person does not belong to answers like a missing one. The audio plays in
 * the page and runs nothing.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { conversationReader } = await getApplicationServices();
  try {
    const opened = await conversationReader.openVoice(actor, params.messageId);
    return new Response(Readable.toWeb(opened.stream) as ReadableStream, {
      headers: conversationVoiceHeaders(opened.voice),
    });
  } catch (error: unknown) {
    logCaughtError("conversation_voice", error);

    if (error instanceof ConversationError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
