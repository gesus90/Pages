import { agentApiFailure } from "@/app/lib/agent-api-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readAgentJson } from "@/app/lib/agent-json.server";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/api-v1-agents";

async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST")
    return agentApiFailure("METHOD_NOT_ALLOWED", 405);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9._~+/-]+=*$/i.test(authorization))
    return agentApiFailure("AUTH_REQUIRED", 401);
  try {
    const services = await getApplicationServices();
    // Verify before reading input; browser cookies and caller-supplied identities never participate.
    const token = authorization.slice(7);
    await services.pagesAgentApiService.verify(token);
    const result = await services.pagesAgentApiService.handle(
      token,
      await readAgentJson(request),
    );
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    logCaughtError("api_v1_agents", error);

    if (error instanceof AgentOperationError)
      return agentApiFailure(error.code, error.status, error.details);
    if (!(error instanceof McpAuthorizationError))
      return agentApiFailure("AUTH_UNAVAILABLE", 503);
    if (error.status === 401) return agentApiFailure("AUTH_INVALID", 401);
    return agentApiFailure(
      error.status === 403 ? "FORBIDDEN" : "INVALID_REQUEST",
      error.status,
    );
  }
}

/** Handles authenticated project, wiki and upload-ticket operations through the versioned agent API. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return handleRequest(request);
}

/** Rejects reads using the stable JSON method error. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return handleRequest(request);
}
