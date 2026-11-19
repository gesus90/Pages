import { Readable } from "node:stream";

import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/chat-player-file";

/**
 * One file of a started player of a web export package:
 * `GET /chat-player/<secret>/index.html`, its start script
 * `pages-player.js`, and the engine script, module, data and start image of
 * the package.
 * @remarks
 * The address alone grants the access: no sign-in of Pages is read, so the
 * player works on an origin of its own that never receives the session
 * cookie. Every request checks that the start is neither stopped nor older
 * than 30 minutes, that its member still belongs to the chat and that the
 * package is still there; otherwise it answers like a missing file. With an
 * own player origin configured, only that host answers. The policy keeps the
 * player inside its package, and only Pages may frame it.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const { conversationWebPackages } = await getApplicationServices();
  if (!conversationWebPackages.servesHost(request.url))
    throw new Response("Not Found", { status: 404 });
  try {
    const opened = await conversationWebPackages.openPlayerFile(
      params.token,
      params.file,
    );
    const body =
      typeof opened.body === "string"
        ? opened.body
        : (Readable.toWeb(opened.body) as ReadableStream);
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Length": String(opened.sizeBytes),
        "Content-Security-Policy": opened.policy,
        "Content-Type": opened.mimeType,
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    if (error instanceof ConversationError)
      throw new Response("Not Found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    logCaughtError("chat_player_file", error);
    throw error;
  }
}
