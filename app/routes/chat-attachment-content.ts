import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/chat-attachment-content";

/** The preview is data for the chat; it is never shown as a document of its own. */
const CONTENT_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * Sends the bounded content preview of a text, PDF or Office attachment of an
 * own chat session as JSON (PAGE-92).
 *
 * @remarks
 * The preview holds plain text, table cells or document sections that the
 * chat shows as text. A foreign and a missing attachment answer alike with 404.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const { chatAttachmentService } = await getApplicationServices();
  try {
    const preview = await chatAttachmentService.preview(
      actor,
      params.attachmentId,
    );
    return Response.json({ ok: true, preview }, { headers: CONTENT_HEADERS });
  } catch (error: unknown) {
    logCaughtError("chat_attachment_content", error);

    if (error instanceof ChatError)
      return Response.json(
        { ok: false, error: "attachmentMissing" },
        { status: 404, headers: CONTENT_HEADERS },
      );
    throw error;
  }
}
