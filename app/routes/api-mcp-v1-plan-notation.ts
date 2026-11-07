import {
  mcpPlanNotationResponse,
  readMcpPlanNotationBody,
  runMcpPlanNotationRoute,
} from "@/app/lib/mcp-plan-notation-route.server";
import { McpPlanNotationRequest } from "@/backend/service/mcp/plan/McpPlanNotationRequest";

import type { McpPlanNotationHandlers } from "@/app/lib/mcp-plan-notation-route.server";
import type { Route } from "./+types/api-mcp-v1-plan-notation";

const HANDLERS: McpPlanNotationHandlers = {
  POST: async ({ api, actor, request }) =>
    mcpPlanNotationResponse(
      await api.plans.create(
        actor,
        McpPlanNotationRequest.create(await readMcpPlanNotationBody(request)),
      ),
      201,
    ),
};

/**
 * Creates a plan from notation (`POST /api/mcp/v1/plan-notation`), PAGE-250 interface 3.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanNotationRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpPlanNotationRoute(request, HANDLERS);
}
