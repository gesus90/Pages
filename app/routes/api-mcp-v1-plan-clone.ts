import {
  mcpPlanBodyRequest,
  mcpPlanResponse,
  requireMcpPlanParameter,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { McpPlanHandlers } from "@/app/lib/mcp-plan-route.server";
import type { Route } from "./+types/api-mcp-v1-plan-clone";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpPlanHandlers {
  // Read inside the handler, so a missing parameter is answered after the token check.
  const path = (): Readonly<Record<string, string>> => ({
    planId: requireMcpPlanParameter(params.planId),
  });
  return {
    POST: async ({ api, identity, request }) =>
      mcpPlanResponse(
        await api.run(
          identity,
          "plans.clone",
          await mcpPlanBodyRequest(request, path()),
        ),
        201,
      ),
  };
}

/**
 * Clones a plan (`POST /api/mcp/v1/plans/{planId}/clone`), PAGE-246 interface 6.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpPlanRoute(request, handlers(params));
}
