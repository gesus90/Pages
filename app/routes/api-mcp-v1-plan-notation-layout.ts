import {
  mcpPlanNotationResponse,
  readMcpPlanNotationBody,
  runMcpPlanNotationRoute,
} from "@/app/lib/mcp-plan-notation-route.server";
import { McpPlanNotationRequest } from "@/backend/service/mcp/plan/McpPlanNotationRequest";

import type { McpPlanNotationHandlers } from "@/app/lib/mcp-plan-notation-route.server";
import type { Route } from "./+types/api-mcp-v1-plan-notation-layout";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpPlanNotationHandlers {
  return {
    POST: async ({ api, actor, request }) =>
      mcpPlanNotationResponse(
        await api.plans.layout(
          actor,
          McpPlanNotationRequest.planId(params.planId),
          McpPlanNotationRequest.layout(await readMcpPlanNotationBody(request)),
        ),
      ),
  };
}

/**
 * Lays out every node of a plan anew (`POST /api/mcp/v1/plan-notation/{planId}/layout`), PAGE-250 interface 5.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanNotationRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpPlanNotationRoute(request, handlers(params));
}
