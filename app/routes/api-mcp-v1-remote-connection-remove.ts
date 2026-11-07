import {
  mcpWorkspaceResponse,
  readMcpWorkspaceBody,
  requireMcpWorkspaceParameter,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-remote-connection-remove";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWorkspaceHandlers {
  return {
    POST: async ({ api, actor, request }) =>
      mcpWorkspaceResponse(
        await api.connections.remove(
          actor.userId,
          requireMcpWorkspaceParameter(params.id),
          McpWorkspaceRequest.removal(await readMcpWorkspaceBody(request)),
        ),
      ),
  };
}

/**
 * Removes a connection after a confirmed question (`POST /api/mcp/v1/remote-connections/{id}/remove`), PAGE-245 interface 16.
 *
 * @remarks
 * Only the device token of a paired machine admits a request, and only for
 * an account with the administrator role. Its stored secrets go with it.
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
