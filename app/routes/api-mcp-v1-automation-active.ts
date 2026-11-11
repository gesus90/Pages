import {
  mcpAutomationResponse,
  readMcpAutomationBody,
  requireMcpAutomationParameter,
  runMcpAutomationRoute,
} from "@/app/lib/mcp-automation-route.server";

import type { McpAutomationHandlers } from "@/app/lib/mcp-automation-route.server";
import type { Route } from "./+types/api-mcp-v1-automation-active";

function handlers(params: Route.ActionArgs["params"]): McpAutomationHandlers {
  return {
    POST: async ({ automations, userId, request }) =>
      mcpAutomationResponse(
        await automations.setActive(
          userId,
          await readMcpAutomationBody(request, {
            automationId: requireMcpAutomationParameter(params.automationId),
          }),
        ),
      ),
  };
}

/** Refuses every method but `POST`. */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpAutomationRoute(request, handlers(params));
}

/**
 * Switches an automation on or off (`POST /api/mcp/v1/automations/{automationId}/active`), PAGE-297.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpAutomationRoute(request, handlers(params));
}
