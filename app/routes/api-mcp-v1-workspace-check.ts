import {
  mcpWorkspaceResponse,
  readMcpWorkspaceBody,
  requireMcpWorkspaceParameter,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-workspace-check";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWorkspaceHandlers {
  return {
    POST: async ({ api, actor, request }) => {
      McpWorkspaceRequest.empty(await readMcpWorkspaceBody(request));
      return mcpWorkspaceResponse(
        await api.workspaces.check(
          actor.userId,
          requireMcpWorkspaceParameter(params.id),
        ),
      );
    },
  };
}

/**
 * Checks a remote workspace again over SSH (`POST /api/mcp/v1/workspaces/{id}/check`), PAGE-245 interface 5.
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
