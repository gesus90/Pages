import {
  mcpAgentResponse,
  readMcpAgentImage,
  requireMcpAgentParameter,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";

import type { McpAgentHandlers } from "@/app/lib/mcp-agent-route.server";
import type { Route } from "./+types/api-mcp-v1-agent-image";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpAgentHandlers {
  return {
    PUT: async ({ api, actor, request }) =>
      mcpAgentResponse(
        await api.agents.setImage(
          actor.userId,
          requireMcpAgentParameter(params.id),
          await readMcpAgentImage(request),
        ),
      ),
    DELETE: async ({ api, actor }) =>
      mcpAgentResponse(
        await api.agents.removeImage(
          actor.userId,
          requireMcpAgentParameter(params.id),
        ),
      ),
  };
}

/**
 * Sets the image of an agent (`PUT /api/mcp/v1/agents/{id}/image`) and removes it (`DELETE`), PAGE-267.
 *
 * @remarks
 * Only the device token of a paired machine admits a request, and only for
 * an account with the administrator role. The image follows the type
 * and size limits of profile images.
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
