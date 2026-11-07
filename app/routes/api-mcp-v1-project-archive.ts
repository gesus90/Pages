import {
  mcpProjectResponse,
  readMcpProjectBody,
  requireMcpProjectParameter,
  runMcpProjectRoute,
} from "@/app/lib/mcp-project-route.server";
import { McpProjectRequest } from "@/backend/service/mcp/project/McpProjectRequest";

import type { McpProjectHandlers } from "@/app/lib/mcp-project-route.server";
import type { Route } from "./+types/api-mcp-v1-project-archive";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpProjectHandlers {
  return {
    POST: async ({ api, context, request }) => {
      const body = McpProjectRequest.confirmation(
        await readMcpProjectBody(request),
      );
      return mcpProjectResponse(
        await api.lifecycle.archive(
          context,
          requireMcpProjectParameter(params.projectId),
          body,
        ),
      );
    },
  };
}

/**
 * Archives a project after a confirmed question; administrators only (`POST /api/mcp/v1/projects/{id}/archive`), PAGE-244 interface 12.
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
