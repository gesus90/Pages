import {
  mcpAutomationResponse,
  readMcpAutomationQuery,
  requireMcpAutomationParameter,
  runMcpAutomationRoute,
} from "@/app/lib/mcp-automation-route.server";

import type { McpAutomationHandlers } from "@/app/lib/mcp-automation-route.server";
import type { Route } from "./+types/api-mcp-v1-automation-runs";

function handlers(params: Route.LoaderArgs["params"]): McpAutomationHandlers {
  return {
    GET: async ({ automations, userId, request }) =>
      mcpAutomationResponse(
        await automations.runs(
          userId,
          readMcpAutomationQuery(request, {
            automationId: requireMcpAutomationParameter(params.automationId),
          }),
        ),
      ),
  };
}

/**
 * Lists the runs of an automation, newest first (`GET /api/mcp/v1/automations/{automationId}/runs`), PAGE-297.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpAutomationRoute(request, handlers(params));
}

/** Refuses every other method. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpAutomationRoute(request, handlers(params));
}
