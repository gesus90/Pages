import { Readable } from "node:stream";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { contentDisposition } from "@/app/lib/content-disposition";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  archiveSize,
  zipArchive,
} from "@/backend/service/conversation/content/ConversationZipArchive";

import type { Route } from "./+types/chat-agent-archive";

/**
 * Sends every file of one message of the person's direct chat with an agent as
 * one ZIP archive: `GET /chat/agent-files/<agentId>/messages/<messageId>/files.zip`,
 * "Alle herunterladen" of a gallery.
 *
 * @remarks
 * The chat is found from the agent and the signed-in person, so a message of
 * another person's chat answers like a missing one. The files keep their names;
 * the archive streams without compression.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const { agentChatAttachments } = await getApplicationServices();
  try {
    const { entries } = await agentChatAttachments.archive(
      person,
      params.agentId,
      params.messageId,
    );
    const size = archiveSize(entries);
    if (size > 0xffffffff) throw new Response("Too Large", { status: 413 });
    const stream = Readable.from(zipArchive(entries, new Date()));
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-cache",
        "Content-Disposition": contentDisposition(
          "attachment",
          `chat-dateien-${params.messageId.slice(0, 8)}.zip`,
        ),
        "Content-Length": String(size),
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    logCaughtError("chat_agent_archive", error);

    if (error instanceof ChatError || error instanceof AgentEmployeeError)
      throw new Response("Not Found", { status: 404 });
    throw error;
  }
}
