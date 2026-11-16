import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { chatAttachmentDownloadHeaders } from "@/app/lib/chat-attachment-headers";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/chat-agent-file";

/**
 * Sends a file the person sent in their direct chat with an agent:
 * `GET /chat/agent-files/<agentId>/<attachmentId>`.
 *
 * @remarks
 * The file lies in the agent's chat session, which is found from the agent
 * and the signed-in person: a file of another person's chat, a foreign
 * and a missing one answer alike. Like every chat attachment it is never
 * shown inline, so an SVG or HTML source cannot run in the origin of Pages.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const { agentChatAttachments } = await getApplicationServices();
  try {
    const { attachment, stream } = await agentChatAttachments.open(
      person,
      params.agentId,
      params.attachmentId,
    );
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: chatAttachmentDownloadHeaders(attachment),
    });
  } catch (error: unknown) {
    logCaughtError("chat_agent_file", error);

    if (error instanceof ChatError || error instanceof AgentEmployeeError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
