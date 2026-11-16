import { agentChatRefusal } from "@/app/lib/agent-chat-failure.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { openChatConversation } from "@/app/lib/chat-page-conversations.server";
import {
  CHAT_NO_STORE,
  chatFailure,
  requireChatRequest,
} from "@/app/lib/chat-response.server";
import { requestEntryContext } from "@/app/lib/request-origin.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  readBody,
  toUploadedFile,
} from "@/app/lib/wiki-actions/wiki-upload.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ChatError } from "@/backend/error/ChatErrors";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  CONVERSATION_ATTACHMENT_MAXIMUM_BYTES,
  CONVERSATION_THUMBNAIL_MAXIMUM_BYTES,
} from "@/definition/ConversationContent";

import type { ChatPageServices } from "@/app/lib/chat-page-conversations.server";
import type { ConversationErrorCode } from "@/definition/Conversation";
import type { ConversationFileFactsInput } from "@/backend/service/conversation/content/ConversationAttachments";
import type { ChatAttachment } from "@/definition/Chat";
import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { User } from "@/definition/User";
import type { Route } from "./+types/chat-page-files";

const STATUS: Readonly<Record<ConversationErrorCode, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  too_large: 413,
  too_long: 400,
  unsupported_format: 415,
};

const METHODS: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];

/** Refuses a body the header already names as too large, before a byte is read. */
function checkLength(request: Request, maximumBytes: number): void {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumBytes)
    throw new ConversationError("too_large");
}

function bodyOf(request: Request): AsyncGenerator<Uint8Array> {
  return readBody(request.body ?? new Blob([]).stream());
}

/** The stored conversation an upload names: by its ID, or as the page has it opened. */
async function readConversationId(
  services: ChatPageServices,
  person: User,
  url: URL,
): Promise<string> {
  const conversationId = url.searchParams.get("conversationId");
  if (conversationId !== null) return conversationId;
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id") ?? "";
  if ((kind !== "group" && kind !== "participant") || id === "")
    throw new ConversationError("invalid");
  const opened = await openChatConversation(services, person, { kind, id });
  return opened.conversationId;
}

async function upload(
  services: ChatPageServices,
  person: User,
  request: Request,
): Promise<ConversationAttachment> {
  const url = new URL(request.url);
  checkLength(request, CONVERSATION_ATTACHMENT_MAXIMUM_BYTES);
  const conversationId = await readConversationId(services, person, url);
  return services.conversationAttachments.upload(
    person,
    {
      conversationId,
      name: url.searchParams.get("name"),
      mimeType: request.headers.get("content-type") ?? "",
    },
    bodyOf(request),
  );
}

/**
 * The resolution and length the browser read of a video or a sound
 * (PAGE-384), or page count and title of a PDF (PAGE-385), from the query.
 */
function factsOf(url: URL): ConversationFileFactsInput | undefined {
  const { searchParams } = url;
  const facts = {
    width: searchParams.get("width") ?? undefined,
    height: searchParams.get("height") ?? undefined,
    durationSeconds: searchParams.get("durationSeconds") ?? undefined,
    pageCount: searchParams.get("pageCount") ?? undefined,
    title: searchParams.get("title") ?? undefined,
  };
  return Object.values(facts).some((entry) => entry !== undefined)
    ? facts
    : undefined;
}

/**
 * A file for the direct chat with an agent, which lives in the agent's chat
 * session and not in a stored conversation.
 */
async function runForAgent(
  services: ChatPageServices,
  person: User,
  request: Request,
  agentId: string,
): Promise<ChatAttachment | null> {
  const url = new URL(request.url);
  const { agentChatAttachments } = services;
  if (request.method === "POST")
    return agentChatAttachments.upload(
      person,
      agentId,
      toUploadedFile(request, url.searchParams.get("name") ?? ""),
    );
  if (request.method !== "DELETE") throw new ConversationError("invalid");
  await agentChatAttachments.discard(
    person,
    agentId,
    url.searchParams.get("attachmentId"),
  );
  return null;
}

async function run(
  services: ChatPageServices,
  person: User,
  request: Request,
): Promise<ConversationAttachment | ChatAttachment | null> {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  if (agentId !== null) return runForAgent(services, person, request, agentId);
  const attachmentId = url.searchParams.get("attachmentId");
  if (request.method === "POST") return upload(services, person, request);
  if (request.method === "PATCH")
    return services.conversationAttachments.recordMediaFacts(
      person,
      attachmentId,
      factsOf(url) ?? {},
    );
  if (request.method === "DELETE") {
    await services.conversationAttachments.discard(person, attachmentId);
    return null;
  }
  checkLength(request, CONVERSATION_THUMBNAIL_MAXIMUM_BYTES);
  const facts = factsOf(url);
  return services.conversationAttachments.uploadThumbnail(
    person,
    {
      attachmentId,
      mimeType: request.headers.get("content-type") ?? "",
      ...(facts ? { facts } : {}),
    },
    bodyOf(request),
  );
}

/**
 * The upload interface of conversation attachments (PAGE-298), for the web
 * and, on its own port with its own sign-in, for Pica Mobile:
 *
 * - `POST /chat-page-api/files?conversationId=…&name=…` (or
 *   `kind=group|participant&id=…` as the chat page has a conversation
 *   opened) with the file as body and its type as `Content-Type` stores an
 *   attachment for a message sent afterwards with its ID.
 * - `PUT /chat-page-api/files?attachmentId=…` with a WebP, JPEG or PNG image
 *   as body stores the preview image of an attachment that has none; with
 *   `width`, `height` and `durationSeconds` it also stores what the browser
 *   read of a video or a sound (PAGE-384); with `pageCount` and `title` the
 *   page count and title of a PDF (PAGE-385).
 * - `PATCH /chat-page-api/files?attachmentId=…&width=…&height=…&durationSeconds=…`
 *   stores only these facts, for a video or sound whose preview exists.
 * - `DELETE /chat-page-api/files?attachmentId=…` drops an own upload that
 *   no message took.
 * - With `agentId=…` instead of the conversation, `POST` and `DELETE` act on
 *   the person's direct chat with that agent: the file goes into the agent's
 *   chat session with the rules of every chat session (types, 16 MB, ten
 *   files), and the message to the agent names its ID.
 *
 * @remarks
 * The file streams into the file store of Pages, at most 512 MB; a larger,
 * refused or interrupted upload leaves no file. Only members of the
 * conversation upload. A refusal answers `{ ok: false, error }` with the
 * code of the {@link ConversationError}.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  try {
    const method = METHODS.find((known) => known === request.method) ?? "POST";
    requireChatRequest(request, method, context.get(requestEntryContext));
    const person = context.get(authenticatedUserContext);
    if (!person) throw new ChatError("accessDenied");
    const services = await getApplicationServices();
    const attachment = await run(services, person, request);
    return Response.json({ ok: true, attachment }, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("chat_page_files", error);

    const refusal =
      error instanceof AgentEmployeeError ? agentChatRefusal(error) : error;
    if (!(refusal instanceof ConversationError)) return chatFailure(refusal);
    return Response.json(
      { ok: false, error: refusal.code },
      { status: STATUS[refusal.code], headers: CHAT_NO_STORE },
    );
  }
}
