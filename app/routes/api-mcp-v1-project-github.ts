import {
  mcpProjectResponse,
  readMcpProjectBody,
  requireMcpProjectParameter,
  runMcpProjectRoute,
} from "@/app/lib/mcp-project-route.server";
import { McpProjectRequest } from "@/backend/service/mcp/project/McpProjectRequest";

import type { McpProjectHandlers } from "@/app/lib/mcp-project-route.server";
import type { Route } from "./+types/api-mcp-v1-project-github";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpProjectHandlers {
  return {
    PUT: async ({ api, context, request }) => {
      const body = McpProjectRequest.gitHub(await readMcpProjectBody(request));
      return mcpProjectResponse({
        project: await api.gitHub.save(
          context,
          requireMcpProjectParameter(params.projectId),
          body,
        ),
      });
    },
    PATCH: async ({ api, context, request }) => {
      const { syncEnabled } = McpProjectRequest.gitHubSwitch(
        await readMcpProjectBody(request),
      );
      return mcpProjectResponse({
        project: await api.gitHub.setSyncEnabled(
          context,
          requireMcpProjectParameter(params.projectId),
          syncEnabled,
        ),
      });
    },
    DELETE: async ({ api, context }) =>
      mcpProjectResponse({
        project: await api.gitHub.disconnect(
          context,
          requireMcpProjectParameter(params.projectId),
        ),
      }),
  };
}

/**
 * Saves the GitHub connection (`PUT /api/mcp/v1/projects/{id}/github`), switches its synchronization (`PATCH`) and removes it (`DELETE`), PAGE-244 interface 11.
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
