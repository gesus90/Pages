import {
  mcpAutomationResponse,
  readMcpAutomationQuery,
  requireMcpAutomationParameter,
  runMcpAutomationRoute,
} from "@/app/lib/mcp-automation-route.server";

import type { McpAutomationHandlers } from "@/app/lib/mcp-automation-route.server";
import type { Route } from "./+types/api-mcp-v1-automation-run-read";

function handlers(params: Route.LoaderArgs["params"]): McpAutomationHandlers {
  return {
    GET: async ({ automations, userId, request }) =>
      mcpAutomationResponse(
        await automations.run(
          userId,
          readMcpAutomationQuery(request, {
            automationId: requireMcpAutomationParameter(params.automationId),
            runId: requireMcpAutomationParameter(params.runId),
          }),
        ),
      ),
  };
}

/**
 * Reads one run of an automation (`GET /api/mcp/v1/automations/{automationId}/runs/{runId}`), PAGE-297.
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
