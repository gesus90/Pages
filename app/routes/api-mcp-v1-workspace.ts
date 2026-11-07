import {
  mcpWorkspaceResponse,
  readMcpWorkspaceBody,
  requireMcpWorkspaceParameter,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-workspace";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWorkspaceHandlers {
  return {
    GET: async ({ api, actor }) =>
      mcpWorkspaceResponse(
        await api.workspaces.read(
          actor.userId,
          requireMcpWorkspaceParameter(params.id),
        ),
      ),
    PATCH: async ({ api, actor, request }) =>
      mcpWorkspaceResponse(
        await api.workspaces.update(
          actor.userId,
          requireMcpWorkspaceParameter(params.id),
          McpWorkspaceRequest.workspaceUpdate(
            await readMcpWorkspaceBody(request),
          ),
        ),
      ),
  };
}

/**
 * Reads a workspace (`GET /api/mcp/v1/workspaces/{id}`) and changes it (`PATCH`), PAGE-245 interface 2 and 4.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
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
