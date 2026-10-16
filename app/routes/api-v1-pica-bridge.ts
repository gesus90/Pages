import { getApplicationServices } from "@/app/lib/services.server";
import { PICA_BRIDGE_MAXIMUM_BODY } from "@/backend/service/chat/acp/PicaBridge";

import type { Route } from "./+types/api-v1-pica-bridge";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

/** Reads at most the bridge limit; a larger declared body is refused without being read. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > PICA_BRIDGE_MAXIMUM_BODY) return null;
  return request.text();
}

async function handleRequest(request: Request): Promise<Response> {
  const bridge = (await getApplicationServices()).picaBridge;
  if (bridge === null)
    return new Response(null, { status: 404, headers: HEADERS });
  const answer = await bridge.handle({
    method: request.method,
    authorization: request.headers.get("Authorization"),
    readBody: () => readBody(request),
  });
  const headers: Record<string, string> = { ...HEADERS };
  if (answer.sessionId) headers["Mcp-Session-Id"] = answer.sessionId;
  if (answer.status === 405) headers.Allow = "POST, DELETE";
  if (answer.body === null)
    return new Response(null, { status: answer.status, headers });
  return Response.json(answer.body, { status: answer.status, headers });
}

/**
 * The MCP endpoint of Pica's tools for Codex over ACP (PAGE-68).
 *
 * @remarks
 * Only a job token admits a request; browser cookies play no part. Bodies,
 * tool arguments and results are never logged.
 */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return handleRequest(request);
}

/** Answers the optional server stream of MCP with 405; the bridge has none. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return handleRequest(request);
}
