import {
  mcpProjectResponse,
  readMcpProjectBody,
  requireMcpProjectParameter,
  runMcpProjectRoute,
} from "@/app/lib/mcp-project-route.server";
import { McpProjectRequest } from "@/backend/service/mcp/project/McpProjectRequest";

import type { McpProjectHandlers } from "@/app/lib/mcp-project-route.server";
import type { Route } from "./+types/api-mcp-v1-project-goal";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpProjectHandlers {
  return {
    PATCH: async ({ api, context, request }) => {
      const { isDone } = McpProjectRequest.goalUpdate(
        await readMcpProjectBody(request),
      );
      return mcpProjectResponse({
        project: await api.planning.setGoalDone(
          context,
          {
            projectId: requireMcpProjectParameter(params.projectId),
            goalId: requireMcpProjectParameter(params.goalId),
          },
          isDone,
        ),
      });
    },
    DELETE: async ({ api, context }) =>
      mcpProjectResponse({
        project: await api.planning.deleteGoal(
          context,
          requireMcpProjectParameter(params.projectId),
          requireMcpProjectParameter(params.goalId),
        ),
      }),
  };
}

/**
 * Marks a goal done or open (`PATCH /api/mcp/v1/projects/{id}/goals/{goalId}`) and deletes it (`DELETE`), PAGE-244 interface 7.
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
