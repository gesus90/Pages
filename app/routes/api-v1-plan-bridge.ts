import { getApplicationServices } from "@/app/lib/services.server";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  PLAN_BRIDGE_MAXIMUM_BODY,
  PlanBridge,
} from "@/backend/service/agents/bridge/PlanBridge";

import type { PlanBridgeResponse } from "@/backend/service/agents/bridge/PlanBridgeProtocol";
import type { Route } from "./+types/api-v1-plan-bridge";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

/**
 * Reads the body as a stream and stops at the bridge limit.
 *
 * @remarks
 * `Content-Length` may be missing, malformed, understated or absent for a
 * chunked body, so the header bounds nothing; a valid declaration above the
 * limit only refuses early, and cancels the unread stream. The bytes are
 * counted as they arrive, and the stream is cancelled as soon as the limit is
 * exceeded, so at most the limit plus one chunk is ever held. A failed or
 * aborted read throws and releases the stream; no payload is logged.
 *
 * @returns The text, or `null` when the body exceeds the limit.
 */
async function readBody(request: Request): Promise<string | null> {
  const declared = request.headers.get("Content-Length");
  if (
    declared !== null &&
    /^\d{1,16}$/u.test(declared) &&
    Number(declared) > PLAN_BRIDGE_MAXIMUM_BODY
  ) {
    // The body is refused unread, so the stream is released instead of being left undrained.
    await request.body?.cancel();
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > PLAN_BRIDGE_MAXIMUM_BODY) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function answerBridge(request: Request): Promise<PlanBridgeResponse> {
  const services = await getApplicationServices();
  const bridge = new PlanBridge(
    services.pagesAgentApiService,
    services.planBridgeGrants,
  );
  try {
    return await bridge.handle({
      method: request.method,
      authorization: request.headers.get("Authorization"),
      readBody: () => readBody(request),
    });
  } catch (caughtError: unknown) {
    logCaughtError("api_v1_plan_bridge", caughtError);

    return { status: 503, body: null };
  }
}

async function handleRequest(request: Request): Promise<Response> {
  const answer = await answerBridge(request);
  const headers: Record<string, string> = { ...HEADERS };
  if (answer.sessionId) headers["Mcp-Session-Id"] = answer.sessionId;
  if (answer.status === 405) headers.Allow = "POST, DELETE";
  if (answer.body === null)
    return new Response(null, { status: answer.status, headers });
  return Response.json(answer.body, { status: answer.status, headers });
}

/**
 * The MCP endpoint of the run-bound tools of an agent plan step.
 *
 * @remarks
 * Only the token of an active step admits a request; browser cookies play no
 * part. Bodies, tool arguments and results are never logged.
 */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return handleRequest(request);
}

/** Answers the optional server stream of MCP with 405; the bridge has none. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return handleRequest(request);
}
