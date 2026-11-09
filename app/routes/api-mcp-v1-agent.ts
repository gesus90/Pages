import {
  mcpAgentResponse,
  readMcpAgentBody,
  requireMcpAgentParameter,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import { McpAgentRequest } from "@/backend/service/mcp/agent/McpAgentRequest";

import type { McpAgentHandlers } from "@/app/lib/mcp-agent-route.server";
import type { Route } from "./+types/api-mcp-v1-agent";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpAgentHandlers {
  return {
    GET: async ({ api, actor }) =>
      mcpAgentResponse(
        await api.agents.read(
          actor.userId,
          requireMcpAgentParameter(params.id),
        ),
      ),
    PATCH: async ({ api, actor, request }) =>
      mcpAgentResponse(
        await api.agents.update(
          actor.userId,
          requireMcpAgentParameter(params.id),
          McpAgentRequest.update(await readMcpAgentBody(request)),
        ),
      ),
  };
}

/**
 * Reads an agent (`GET /api/mcp/v1/agents/{id}`) and changes it (`PATCH`), PAGE-267.
 *
 * @remarks
 * Only the device token of a paired machine admits a request, and only for
 * an account with the administrator role. A change needs the current
 * `revision`; `isActive: false` deactivates an agent that is not running.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpAgentRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpAgentRoute(request, handlers(params));
}
