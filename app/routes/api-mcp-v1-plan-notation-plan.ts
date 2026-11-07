import {
  mcpPlanNotationResponse,
  readMcpPlanNotationBody,
  runMcpPlanNotationRoute,
} from "@/app/lib/mcp-plan-notation-route.server";
import { McpPlanNotationRequest } from "@/backend/service/mcp/plan/McpPlanNotationRequest";

import type { McpPlanNotationHandlers } from "@/app/lib/mcp-plan-notation-route.server";
import type { Route } from "./+types/api-mcp-v1-plan-notation-plan";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpPlanNotationHandlers {
  return {
    GET: async ({ api, actor }) =>
      mcpPlanNotationResponse(
        await api.plans.read(
          actor,
          McpPlanNotationRequest.planId(params.planId),
        ),
      ),
    PUT: async ({ api, actor, request }) =>
      mcpPlanNotationResponse(
        await api.plans.replace(
          actor,
          McpPlanNotationRequest.planId(params.planId),
          McpPlanNotationRequest.replace(
            await readMcpPlanNotationBody(request),
          ),
        ),
      ),
  };
}

/**
 * Reads a plan as notation (`GET /api/mcp/v1/plan-notation/{planId}`) and
 * replaces it by a notation (`PUT`), PAGE-250 interface 2 and 4.
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
