import {
  mcpPlanQueryRequest,
  mcpPlanResponse,
  runMcpPlanRoute,
} from "@/app/lib/mcp-plan-route.server";

import type { McpPlanHandlers } from "@/app/lib/mcp-plan-route.server";
import type { Route } from "./+types/api-mcp-v1-plan-capabilities";

/** The methods of this resource. */
function handlers(): McpPlanHandlers {
  return {
    GET: async ({ api, identity, request }) =>
      mcpPlanResponse(
        await api.run(
          identity,
          "plans.capabilities.read",
          mcpPlanQueryRequest(request),
        ),
      ),
  };
}

/**
 * Reads the plan contract and its operations (`GET /api/mcp/v1/plans/capabilities`), PAGE-246 interface 1.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanRoute(request, handlers());
}
