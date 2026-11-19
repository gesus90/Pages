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
import { CHAT_CALL_SIGNAL_MAXIMUM_CHARACTERS } from "@/definition/ChatCall";

import type { ConversationErrorCode } from "@/definition/Conversation";
import type { Route } from "./+types/chat-page-call-media";

const STATUS: Readonly<Record<ConversationErrorCode, number>> = {
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  too_large: 413,
  too_long: 400,
  unsupported_format: 415,
};

const text = z.string().max(CHAT_CALL_SIGNAL_MAXIMUM_CHARACTERS);

const signalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["offer", "answer"]),
    description: text.min(1),
  }),
  z.object({
    kind: z.literal("candidate"),
    candidate: text,
    sdpMid: text.nullable(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable(),
    usernameFragment: text.nullable(),
  }),
]);

const requestSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("signal"),
    callId: z.string().min(1).max(200),
    signal: signalSchema,
  }),
  z.object({
    intent: z.literal("ice"),
    callId: z.string().min(1).max(200),
  }),
]);

const querySchema = z.object({
  callId: z.string().min(1).max(200),
  after: z.coerce.number().int().min(0).default(0),
});

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ConversationError("invalid");
  }
}

function refusal(error: unknown): Response {
  if (!(error instanceof ConversationError)) return chatFailure(error);
  return Response.json(
    { ok: false, error: error.code },
    { status: STATUS[error.code], headers: CHAT_NO_STORE },
  );
}

/**
 * Reads what the other member of a running call sent:
 * `GET /chat-page-api/call-media?callId=…&after=…`.
 * @remarks
 * The request waits up to twenty seconds for news and answers
 * `{ signals, isEnded }`. The server checks account, participation and the
 * state of the call at every read; a call the account is no member of
 * answers as a missing one.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  try {
    requireChatRequest(request, "GET", context.get(requestEntryContext));
    const query = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) throw new ConversationError("invalid");
    const { chatCallService } = await getApplicationServices();
    const batch = await chatCallService.readSignals(person, query.data.callId, {
      after: query.data.after,
      abort: request.signal,
    });
    return Response.json(batch, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    return refusal(error);
  }
}

/**
 * Passes a connection signal on or issues the ICE servers of a running call:
 * `POST /chat-page-api/call-media` with `{ intent: "signal", callId, signal }`
 * or `{ intent: "ice", callId }`.
 * @remarks
 * Only the two members of a running call may do either; TURN credentials are
 * temporary, belong to this call and go to no one else. A refusal answers
 * `{ ok: false, error }` with the code of the {@link ConversationError}.
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
    if (parsed.data.intent === "ice")
      return Response.json(
        await chatCallService.iceServers(person, parsed.data.callId),
        { headers: CHAT_NO_STORE },
      );
    await chatCallService.signal(
      person,
      parsed.data.callId,
      parsed.data.signal,
    );
    return Response.json({ ok: true }, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    return refusal(error);
  }
}
