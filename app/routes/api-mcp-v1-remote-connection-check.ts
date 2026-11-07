import {
  mcpWorkspaceResponse,
  readMcpWorkspaceBody,
  requireMcpWorkspaceParameter,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-remote-connection-check";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWorkspaceHandlers {
  return {
    POST: async ({ api, actor, request }) => {
      McpWorkspaceRequest.empty(await readMcpWorkspaceBody(request));
      return mcpWorkspaceResponse(
        await api.connections.check(
          actor.userId,
          requireMcpWorkspaceParameter(params.id),
        ),
        202,
      );
    },
  };
}

/**
 * Starts the check of a stored connection (`POST /api/mcp/v1/remote-connections/{id}/check`), PAGE-245 interface 14.
 *
 * @remarks
 * Only the device token of a paired machine admits a request, and only for
 * an account with the administrator role. The result stands in `lastCheck` later.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, handlers(params));
}
