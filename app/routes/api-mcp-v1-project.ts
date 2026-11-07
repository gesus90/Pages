import {
  mcpProjectResponse,
  readMcpProjectBody,
  requireMcpProjectParameter,
  runMcpProjectRoute,
} from "@/app/lib/mcp-project-route.server";
import { McpProjectRequest } from "@/backend/service/mcp/project/McpProjectRequest";

import type { McpProjectHandlers } from "@/app/lib/mcp-project-route.server";
import type { Route } from "./+types/api-mcp-v1-project";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpProjectHandlers {
  return {
    GET: async ({ api, context }) =>
      mcpProjectResponse({
        project: await api.reads.read(
          context,
          requireMcpProjectParameter(params.projectId),
        ),
      }),
    PATCH: async ({ api, context, request }) => {
      const body = McpProjectRequest.patch(await readMcpProjectBody(request));
      return mcpProjectResponse({
        project: await api.writes.patch(
          context,
          requireMcpProjectParameter(params.projectId),
          body,
        ),
      });
    },
  };
}

/**
 * Reads a project (`GET /api/mcp/v1/projects/{id}`) and changes it (`PATCH`), PAGE-244 interface 2 and 4.
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
