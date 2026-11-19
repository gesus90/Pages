import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  CHAT_NO_STORE,
  chatFailure,
  readChatJson,
  requireChatRequest,
} from "@/app/lib/chat-response.server";
import { requestEntryContext } from "@/app/lib/request-origin.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ChatError } from "@/backend/error/ChatErrors";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/chat-page-web-packages";

/**
 * The player starts of web export packages in the chat:
 * - `POST /chat-page-api/web-packages` with `{ attachmentId }` starts the
 *   player of a package for the signed-in member and answers
 *   `{ ok: true, session: { url, expiresAt, isOwnOrigin } }`.
 * - `DELETE /chat-page-api/web-packages?token=…` stops a start of the
 *   signed-in account; its files answer no more.
 * @remarks
 * Only a member of the chat of a sent package starts its player; any other
 * account, an expired or incomplete package answers `not_found`, as a
 * missing one does. The address holds a secret of 30 minutes, never a path
 * of the server.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  try {
    const method = request.method === "DELETE" ? "DELETE" : "POST";
    requireChatRequest(request, method, context.get(requestEntryContext));
    const person = context.get(authenticatedUserContext);
    if (!person) throw new ChatError("accessDenied");
    const { conversationWebPackages } = await getApplicationServices();
    if (method === "DELETE") {
      await conversationWebPackages.revoke(
        person,
        new URL(request.url).searchParams.get("token"),
      );
      return Response.json({ ok: true }, { headers: CHAT_NO_STORE });
    }
    const body = await readChatJson(request);
    const session = await conversationWebPackages.grant(
      person,
      body.attachmentId,
    );
    return Response.json({ ok: true, session }, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("chat_page_web_packages", error);

    if (!(error instanceof ConversationError)) return chatFailure(error);
    return Response.json(
      { ok: false, error: error.code },
      { status: 404, headers: CHAT_NO_STORE },
    );
  }
}
