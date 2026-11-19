import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ConversationError } from "@/backend/error/ConversationError";

import type { Route } from "./+types/chat-player-frame";

function escapeAttribute(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** The frame document: no script of its own, the player in one frame of its origin. */
function frameDocument(url: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Player</title>
<style>html,body{height:100%;margin:0;background:#000}iframe{display:block;width:100%;height:100%;border:0}</style>
</head>
<body>
<iframe src="${escapeAttribute(url)}" sandbox="allow-scripts allow-pointer-lock allow-same-origin" allow="fullscreen; gamepad; autoplay" referrerpolicy="no-referrer" title="Player"></iframe>
</body>
</html>`;
}

/**
 * Frames the player of a started web export package on the own player
 * origin: `GET /chat/player-frame/<secret>`.
 * @remarks
 * The policy of the chat page frames only Pages itself, so the chat frames
 * this document of Pages, which carries no script and whose policy frames
 * the player origin only. Only the account that started the player gets it,
 * while the start runs and the account is a member of the chat; anything
 * else answers 404. The inner frame keeps the player origin, which never
 * receives the sign-in of Pages, and has no bridge to the chat.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  const person = context.get(authenticatedUserContext);
  if (!person) throw new Response("Forbidden", { status: 403 });
  const { conversationWebPackages } = await getApplicationServices();
  let address: string;
  try {
    address = await conversationWebPackages.playerFrameAddress(
      person,
      params.token,
    );
  } catch (error: unknown) {
    if (error instanceof ConversationError)
      throw new Response("Not Found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    throw error;
  }
  const origin = new URL(address).origin;
  return new Response(frameDocument(address), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; frame-src ${origin}; frame-ancestors 'self'`,
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
