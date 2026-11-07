import {
  mcpWorkspaceResponse,
  requireMcpWorkspaceParameter,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-workspace-usages";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWorkspaceHandlers {
  return {
    GET: async ({ api, actor }) =>
      mcpWorkspaceResponse(
        await api.workspaces.usages(
          actor.userId,
          requireMcpWorkspaceParameter(params.id),
        ),
      ),
  };
}

/**
 * Lists what refers to a workspace (`GET /api/mcp/v1/workspaces/{id}/usages`), PAGE-245 interface 6.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. Names appear
 * only for accounts with the administrator role.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, handlers(params));
}

/** Answers every changing method with `405`, as the resource only reads. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, handlers(params));
}
