import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/chat-embed";

function escapeAttribute(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** The frame document: no script of its own, one sandboxed frame without credentials. */
function frameDocument(url: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Embedded page</title>
<style>html,body{height:100%;margin:0}iframe{display:block;width:100%;height:100%;border:0}</style>
</head>
<body>
<iframe src="${escapeAttribute(url)}" sandbox="allow-scripts allow-forms" credentialless referrerpolicy="no-referrer" loading="lazy" title="Embedded page"></iframe>
</body>
</html>`;
}

/**
 * Frames a web page for the chat, when it may be embedded (PAGE-298):
 * `GET /chat/embed?url=<url>&conversationId=<id>`.
 *
 * @remarks
 * The server decides on every request: only Pages itself, local previews on
 * `127.0.0.1` or `localhost`, the domains released for every conversation
 * and, for a member, the domains released for the named conversation are
 * framed; everything else answers 403 and stays a link card. The answer is a
 * document without script whose policy allows frames of that one origin
 * only, so the page of Pages itself never frames a foreign origin. The
 * inner frame is sandboxed with scripts and forms but without the own
 * origin: the embedded page reaches neither the cookies of Pages nor the
 * parent window, and it loads without credentials.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const parameters = new URL(request.url).searchParams;
  const url = parameters.get("url") ?? "";
  const { conversationLinks } = await getApplicationServices();
  const isEmbeddable = await conversationLinks.isEmbeddable(actor, {
    url,
    conversationId: parameters.get("conversationId"),
    requestHost: new URL(request.url).hostname.toLowerCase(),
  });
  if (!isEmbeddable) throw new Response("Forbidden", { status: 403 });
  const target = new URL(url);
  return new Response(frameDocument(target.href), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; frame-src ${target.origin}; frame-ancestors 'self'`,
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
