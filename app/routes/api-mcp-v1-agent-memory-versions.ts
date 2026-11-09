import {
  mcpAgentResponse,
  requireMcpAgentParameter,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import { McpAgentRequest } from "@/backend/service/mcp/agent/McpAgentRequest";

import type { McpAgentHandlers } from "@/app/lib/mcp-agent-route.server";
import type { Route } from "./+types/api-mcp-v1-agent-memory-versions";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpAgentHandlers {
  return {
    GET: async ({ api, actor, request }) => {
      McpAgentRequest.empty(new URL(request.url).searchParams);
      return mcpAgentResponse(
        await api.agents.memoryVersions(
          actor.userId,
          requireMcpAgentParameter(params.id),
        ),
      );
    },
  };
}

/**
 * Lists the versions of `MEMORY.md` (`GET /api/mcp/v1/agents/{id}/memory/versions`), the newest first, PAGE-267.
 *
 * @remarks
 * Only the device token of a paired machine admits a request, and only for
 * an account with the administrator role.
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
