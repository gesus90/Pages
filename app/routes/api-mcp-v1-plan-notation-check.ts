import {
  mcpPlanNotationResponse,
  readMcpPlanNotationBody,
  runMcpPlanNotationRoute,
} from "@/app/lib/mcp-plan-notation-route.server";
import { McpPlanNotationRequest } from "@/backend/service/mcp/plan/McpPlanNotationRequest";

import type { McpPlanNotationHandlers } from "@/app/lib/mcp-plan-notation-route.server";
import type { Route } from "./+types/api-mcp-v1-plan-notation-check";

const HANDLERS: McpPlanNotationHandlers = {
  POST: async ({ api, actor, request }) =>
    mcpPlanNotationResponse(
      await api.plans.check(
        actor,
        McpPlanNotationRequest.check(await readMcpPlanNotationBody(request)),
      ),
    ),
};

/**
 * Checks a notation without storing it (`POST /api/mcp/v1/plan-notation/check`), PAGE-250 interface 1.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. With a
 * `planId`, the answer previews what replacing that plan would change.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpPlanNotationRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpPlanNotationRoute(request, HANDLERS);
}
