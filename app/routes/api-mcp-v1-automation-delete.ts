import {
  mcpAutomationResponse,
  readMcpAutomationBody,
  requireMcpAutomationParameter,
  runMcpAutomationRoute,
} from "@/app/lib/mcp-automation-route.server";

import type { McpAutomationHandlers } from "@/app/lib/mcp-automation-route.server";
import type { Route } from "./+types/api-mcp-v1-automation-delete";

function handlers(params: Route.ActionArgs["params"]): McpAutomationHandlers {
  return {
    POST: async ({ automations, userId, request }) =>
      mcpAutomationResponse(
        await automations.delete(
          userId,
          await readMcpAutomationBody(request, {
            automationId: requireMcpAutomationParameter(params.automationId),
          }),
          { requiresWord: false },
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
 * Deletes an automation (`POST /api/mcp/v1/automations/{automationId}/delete`), PAGE-297.
 *
 * @remarks
 * Without `confirmed: true` the answer is the scope and nothing changes;
 * the client confirms it explicitly in a second call.
 */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpAutomationRoute(request, handlers(params));
}
