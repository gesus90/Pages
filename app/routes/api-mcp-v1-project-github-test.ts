import {
  mcpProjectResponse,
  readMcpProjectBody,
  requireMcpProjectParameter,
  runMcpProjectRoute,
} from "@/app/lib/mcp-project-route.server";
import { McpProjectRequest } from "@/backend/service/mcp/project/McpProjectRequest";

import type { McpProjectHandlers } from "@/app/lib/mcp-project-route.server";
import type { Route } from "./+types/api-mcp-v1-project-github-test";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpProjectHandlers {
  return {
    POST: async ({ api, context, request }) => {
      McpProjectRequest.empty(await readMcpProjectBody(request));
      return mcpProjectResponse(
        await api.gitHub.test(
          context,
          requireMcpProjectParameter(params.projectId),
        ),
      );
    },
  };
}

/**
 * Tests the GitHub connection (`POST /api/mcp/v1/projects/{id}/github/test`), PAGE-244 interface 11.
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
