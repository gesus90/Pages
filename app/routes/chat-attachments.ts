import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  CHAT_NO_STORE,
  chatFailure,
  requireChatRequest,
} from "@/app/lib/chat-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { toUploadedFile } from "@/app/lib/wiki-actions/wiki-upload.server";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/chat-attachments";

/**
 * Takes a file for the next chat message:
 * `PUT /chat-api/attachments?session=<id>&name=<name>` with the file as body (T6.12.4).
 *
 * @remarks
 * The body streams to the disk while it is counted against the limit of the
 * administrator; the type is decided from the content afterwards.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  try {
    requireChatRequest(request, "PUT");
    const actor = context.get(authenticatedUserContext);
    if (!actor) throw new ChatError("accessDenied");
    const { chatAttachmentService } = await getApplicationServices();
    const url = new URL(request.url);
    const attachment = await chatAttachmentService.upload(
      actor,
      url.searchParams.get("session"),
      toUploadedFile(request, url.searchParams.get("name") ?? ""),
    );
    return Response.json({ ok: true, attachment }, { headers: CHAT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("chat_attachments", error);

    return chatFailure(error);
  }
}
