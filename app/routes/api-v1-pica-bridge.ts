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
    signal: request.signal,
    readBody: () => readBody(request),
  });
  const headers: Record<string, string> = { ...HEADERS };
  if (answer.status === 405) headers.Allow = "POST";
  if (answer.body === null)
    return new Response(null, { status: answer.status, headers });
  return Response.json(answer.body, { status: answer.status, headers });
}

/**
 * The endpoint of Pica's turn-bound tools.
 *
 * @remarks
 * Only an active turn token admits a request; browser cookies play no part. Bodies,
 * tool arguments and results are never logged.
 */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return handleRequest(request);
}

/** Refuses requests other than the authenticated tool POST. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return handleRequest(request);
}
