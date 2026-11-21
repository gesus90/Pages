import {
  mcpMilestoneWrite,
  requireMcpMilestoneParameter,
  runMcpMilestoneRoute,
} from "@/app/lib/mcp-milestone-route.server";

import type { McpMilestoneHandlers } from "@/app/lib/mcp-milestone-route.server";
import type { Route } from "./+types/api-mcp-v1-project-milestone-archive";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpMilestoneHandlers {
  // Read inside the handler, so a missing parameter is answered after the token check.
  const path = (): Readonly<Record<string, string>> => ({
    projectId: requireMcpMilestoneParameter(params.projectId),
    milestoneId: requireMcpMilestoneParameter(params.milestoneId),
  });
  return {
    POST: mcpMilestoneWrite("milestone.delete", path),
  };
}

/**
 * Archives a milestone together with its dependencies
 * (`POST /api/mcp/v1/projects/{projectId}/milestones/{milestoneId}/archive`);
 * no confirmation word is asked.
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpMilestoneRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpMilestoneRoute(request, handlers(params));
}
