import {
  mcpPlanQueryRequest,
  mcpPlanResponse,
  requireMcpPlanParameter,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { McpPlanHandlers } from "@/app/lib/mcp-plan-route.server";
import type { Route } from "./+types/api-mcp-v1-plan-control";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpPlanHandlers {
  // Read inside the handler, so a missing parameter is answered after the token check.
  const path = (): Readonly<Record<string, string>> => ({
    planId: requireMcpPlanParameter(params.planId),
  });
  return {
    GET: async ({ api, identity, request }) =>
      mcpPlanResponse(
        await api.run(
          identity,
          "plans.control.read",
          mcpPlanQueryRequest(request, path()),
        ),
      ),
  };
}

/**
 * Reads the allowed actions and blockers of a plan (`GET /api/mcp/v1/plans/{planId}/control`), PAGE-246 interface 12.
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
