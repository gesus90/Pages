import {
  mcpAgentResponse,
  readMcpAgentBody,
  requireMcpAgentParameter,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import { McpAgentRequest } from "@/backend/service/mcp/agent/McpAgentRequest";

import type { McpAgentHandlers } from "@/app/lib/mcp-agent-route.server";
import type { Route } from "./+types/api-mcp-v1-agent-memory-version-restore";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpAgentHandlers {
  return {
    POST: async ({ api, actor, request }) =>
      mcpAgentResponse(
        await api.agents.restoreMemory(
          actor.userId,
          {
            id: requireMcpAgentParameter(params.id),
            versionId: requireMcpAgentParameter(params.versionId),
          },
          McpAgentRequest.restore(await readMcpAgentBody(request)),
        ),
      ),
  };
}

/**
 * Restores a version of `MEMORY.md` and its archive (`POST /api/mcp/v1/agents/{id}/memory/versions/{versionId}/restore`), PAGE-267.
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
