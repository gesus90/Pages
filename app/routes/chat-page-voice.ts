import { authenticatedUserContext } from "@/app/lib/auth.server";
import { openChatConversation } from "@/app/lib/chat-page-conversations.server";
import {
  CHAT_NO_STORE,
  chatFailure,
  requireChatRequest,
} from "@/app/lib/chat-response.server";
import { requestEntryContext } from "@/app/lib/request-origin.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readBody } from "@/app/lib/wiki-actions/wiki-upload.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ChatError } from "@/backend/error/ChatErrors";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { CONVERSATION_VOICE_MAXIMUM_BYTES } from "@/definition/Conversation";

import type { ChatPageServices } from "@/app/lib/chat-page-conversations.server";
import type { ConversationErrorCode } from "@/definition/Conversation";
import type { User } from "@/definition/User";
import type { VirtualChatSelection } from "@/definition/VirtualChat";
import type { Route } from "./+types/chat-page-voice";

const STATUS: Readonly<Record<ConversationErrorCode, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  too_large: 413,
  too_long: 400,
  unsupported_format: 415,
};

function readSelection(url: URL): VirtualChatSelection {
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id") ?? "";
  if ((kind !== "group" && kind !== "participant") || id === "")
    throw new ConversationError("invalid");
  return { kind, id };
}

/** Refuses a body the header already names as too large, before a byte is read. */
function checkLength(request: Request): void {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > CONVERSATION_VOICE_MAXIMUM_BYTES)
    throw new ConversationError("too_large");
}

async function sendVoice(
  services: ChatPageServices,
  person: User,
  request: Request,
): Promise<string> {
  const url = new URL(request.url);
  const selection = readSelection(url);
  checkLength(request);
  const { conversationService } = services;
  const { conversationId, isOwn } = await openChatConversation(
    services,
    person,
    selection,
  );
  const ticket = await conversationService.beginVoice(person, {
    conversationId,
    clientMessageId: url.searchParams.get("clientMessageId") ?? "",
    mimeType: request.headers.get("content-type") ?? "",
    durationMs: Number(url.searchParams.get("durationMs")),
  });
  const file = await conversationService.storeVoice(
    ticket,
    readBody(request.body ?? new Blob([]).stream()),
  );
  const message = await conversationService.sendVoice(person, {
    ticket,
    file,
  });
  if (isOwn) await recordActivity(services, person, selection);
  return message.id;
}

/** A conversation outside the person's own list changes no order. */
async function recordActivity(
  services: ChatPageServices,
  person: User,
  selection: VirtualChatSelection,
): Promise<void> {
  try {
    await services.chatGroupService.recordActivity(person, selection);
  } catch (error: unknown) {
    if (!(error instanceof AgentEmployeeError) || error.code !== "notFound")
      throw error;
  }
}

/**
 * Sends a voice message of the chat page (PAGE-277):
 * `POST /chat-page-api/voice?kind=group|participant&id=…&clientMessageId=…&durationMs=…`
 * with the WAV or MP3 file as body and its type as `Content-Type`.
 *
 * @remarks
 * The audio streams into the file store of Pages and is checked there: WAV
 * or MP3 by its content, at most 25 MB and the longest recording of Pages.
 * A refusal answers `{ ok: false, error }` with the code of the
 * {@link ConversationError}; the page explains it. The text follows after the
 * sending, recognized outside the request.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  try {
    requireChatRequest(request, "POST", context.get(requestEntryContext));
    const person = context.get(authenticatedUserContext);
    if (!person) throw new ChatError("accessDenied");
    const services = await getApplicationServices();
    const messageId = await sendVoice(services, person, request);
    return Response.json({ ok: true, messageId }, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("chat_page_voice", error);

    if (!(error instanceof ConversationError)) return chatFailure(error);
    return Response.json(
      { ok: false, error: error.code },
      { status: STATUS[error.code], headers: CHAT_NO_STORE },
    );
  }
}
