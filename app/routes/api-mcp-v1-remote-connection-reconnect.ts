import {
  mcpWorkspaceResponse,
  readMcpWorkspaceBody,
  requireMcpWorkspaceParameter,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-remote-connection-reconnect";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWorkspaceHandlers {
  return {
    POST: async ({ api, actor, request }) => {
      McpWorkspaceRequest.empty(await readMcpWorkspaceBody(request));
      return mcpWorkspaceResponse(
        await api.connections.reconnect(
          actor.userId,
          requireMcpWorkspaceParameter(params.id),
        ),
      );
    },
  };
}

/**
 * Starts a new series of connection attempts (`POST /api/mcp/v1/remote-connections/{id}/reconnect`), PAGE-245 interface 15.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The account
 * needs the right to use the connection.
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
