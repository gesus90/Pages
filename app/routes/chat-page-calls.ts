import { z } from "zod";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  CHAT_NO_STORE,
  chatFailure,
  requireChatRequest,
} from "@/app/lib/chat-response.server";
import { requestEntryContext } from "@/app/lib/request-origin.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { CHAT_CALL_ACTIONS } from "@/definition/ChatCall";

import type { ConversationErrorCode } from "@/definition/Conversation";
import type { Route } from "./+types/chat-page-calls";

const STATUS: Readonly<Record<ConversationErrorCode, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  too_large: 413,
  too_long: 400,
  unsupported_format: 415,
};

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ConversationError("invalid");
  }
}

const requestSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("start"),
    participantId: z.string().min(1).max(200),
  }),
  z.object({
    intent: z.literal("respond"),
    callId: z.string().min(1).max(200),
    action: z.enum(CHAT_CALL_ACTIONS),
  }),
]);

/** Reads the calls the signed-in account takes part in, for the bar and the notice. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  return Response.json(await services.chatCallService.list(person), {
    headers: CHAT_NO_STORE,
  });
}

/**
 * Starts a call from the direct chat with a person, or answers, cancels
 * or ends one: `POST /chat-page-api/calls` with `{ intent: "start", participantId }`
 * or `{ intent: "respond", callId, action }`.
 * @remarks
 * The caller is always the signed-in account and the recipient the person of
 * the direct chat; a call only its two members can see or change. A refusal
 * answers `{ ok: false, error }` with the code of the {@link ConversationError}.
 * The call itself carries no audio: once accepted, the browsers connect
 * through `chat-page-api/call-media`.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  try {
    requireChatRequest(request, "POST", context.get(requestEntryContext));
    const parsed = requestSchema.safeParse(await readBody(request));
    if (!parsed.success) throw new ConversationError("invalid");
    const { chatCallService } = await getApplicationServices();
    if (parsed.data.intent === "start")
      await chatCallService.start(person, parsed.data.participantId);
    else
      await chatCallService.respond(
        person,
        parsed.data.callId,
        parsed.data.action,
      );
    return Response.json({ ok: true }, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    if (!(error instanceof ConversationError)) return chatFailure(error);
    return Response.json(
      { ok: false, error: error.code },
      { status: STATUS[error.code], headers: CHAT_NO_STORE },
    );
  }
}
