import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  CHAT_NO_STORE,
  chatFailure,
  readChatJson,
  requireChatRequest,
} from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { ChatSendResult } from "@/definition/Chat";
import type { User } from "@/definition/User";
import type { Route } from "./+types/chat-api";

/** Answers a sent message with the key the browser reads: `reply`, `job` or `steer`. */
function sendResult(sent: ChatSendResult): Readonly<Record<string, unknown>> {
  switch (sent.kind) {
    case "reply":
      return { reply: sent.reply };
    case "job":
      return { job: sent.job };
    case "steer":
      return { steer: sent.steer };
  }
}

/** The intents of Pica's server-side jobs (PAGE-68): read the journal after a cursor, or stop. */
async function handleJobIntent(
  services: ApplicationServices,
  actor: User,
  input: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const jobs = services.picaAcpService;
  if (input.intent === "stop") {
    await jobs?.stop(actor, input.sessionId);
    return {};
  }
  return { update: jobs ? await jobs.update(actor, input) : null };
}

/** Runs one chat intent for the signed-in person; every intent acts on own sessions only. */
async function handleIntent(
  services: ApplicationServices,
  actor: User,
  input: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
  const sessions = services.chatSessionService;
  switch (input.intent) {
    case "open":
      return { overview: await sessions.open(actor) };
    case "new":
      return { view: await sessions.create(actor) };
    case "sessions":
      return { sessions: await sessions.list(actor) };
    case "session":
      return { view: await sessions.view(actor, input.sessionId) };
    case "send":
      return sendResult(
        await services.chatService.submit(actor, input.message),
      );
    case "job":
    case "stop":
      return handleJobIntent(services, actor, input);
    case "delete":
      return {
        deletion: await sessions.removeSelected(actor, input.sessionIds),
      };
    case "compact":
      return {
        compaction: await services.chatContextService.compact(
          actor,
          input.sessionId,
        ),
      };
    case "context":
      return {
        context: await services.chatContextService.size(actor, input.sessionId),
      };
    case "discard":
      await services.chatAttachmentService.discard(actor, input.attachmentId);
      return {};
    case "cancel":
      services.chatService.cancel(actor, input.requestId);
      return {};
    default:
      throw new ChatError("invalidInput");
  }
}

/**
 * The JSON interface of the global chat (A11.4): open, `/new`, `/sessions`,
 * switching, sending, `/delete`, discarding an unsent attachment and cancelling;
 * for Codex agents also reading a job after a cursor and stopping it (PAGE-68).
 *
 * @remarks
 * Only POST requests of the own origin are accepted. Answers are never cached
 * and carry stable error codes instead of messages.
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    requireChatRequest(request, "POST");
    const actor = context.get(authenticatedUserContext);
    if (!actor) throw new ChatError("accessDenied");
    const services = await getApplicationServices();
    const input = await readChatJson(request);
    if (input.intent === "send")
      services.picaAdminService.protectOrigin(new URL(request.url).origin);
    const result = await handleIntent(services, actor, input);
    return Response.json({ ok: true, ...result }, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("chat_api", error);

    return chatFailure(error);
  }
}
