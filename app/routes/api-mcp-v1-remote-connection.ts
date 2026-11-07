import {
  mcpWorkspaceResponse,
  readMcpWorkspaceBody,
  requireMcpWorkspaceParameter,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-remote-connection";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWorkspaceHandlers {
  return {
    GET: async ({ api, actor }) =>
      mcpWorkspaceResponse(
        await api.connections.read(
          actor.userId,
          requireMcpWorkspaceParameter(params.id),
        ),
      ),
    PATCH: async ({ api, actor, request }) =>
      mcpWorkspaceResponse(
        await api.connections.update(
          actor.userId,
          requireMcpWorkspaceParameter(params.id),
          McpWorkspaceRequest.connectionUpdate(
            await readMcpWorkspaceBody(request),
          ),
        ),
      ),
  };
}

/**
 * Reads a connection (`GET /api/mcp/v1/remote-connections/{id}`) and changes it (`PATCH`), PAGE-245 interface 10 and 13.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. Changing needs the administrator role.
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
