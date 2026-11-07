import {
  mcpPlanBodyRequest,
  mcpPlanQueryRequest,
  mcpPlanResponse,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { McpPlanHandlers } from "@/app/lib/mcp-plan-route.server";
import type { Route } from "./+types/api-mcp-v1-plans";

/** The methods of this resource. */
function handlers(): McpPlanHandlers {
  return {
    GET: async ({ api, identity, request }) =>
      mcpPlanResponse(
        await api.run(identity, "plans.list", mcpPlanQueryRequest(request)),
      ),
    POST: async ({ api, identity, request }) =>
      mcpPlanResponse(
        await api.run(
          identity,
          "plans.create",
          await mcpPlanBodyRequest(request),
        ),
        201,
      ),
  };
}

/**
 * Lists the visible plans (`GET /api/mcp/v1/plans`) and creates one (`POST`), PAGE-246 interface 2 and 3.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(request, handlers());
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpPlanRoute(request, handlers());
}
