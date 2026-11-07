import {
  mcpProjectResponse,
  requireMcpProjectParameter,
  runMcpProjectRoute,
} from "@/app/lib/mcp-project-route.server";

import type { McpProjectHandlers } from "@/app/lib/mcp-project-route.server";
import type { Route } from "./+types/api-mcp-v1-project-event";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpProjectHandlers {
  return {
    DELETE: async ({ api, context }) =>
      mcpProjectResponse({
        project: await api.planning.archiveEvent(
          context,
          requireMcpProjectParameter(params.projectId),
          requireMcpProjectParameter(params.eventId),
        ),
      }),
  };
}

/**
 * Archives a date (`DELETE /api/mcp/v1/projects/{id}/events/{eventId}`), PAGE-244 interface 8.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpProjectRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpProjectRoute(request, handlers(params));
}
