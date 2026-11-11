import {
  mcpAutomationResponse,
  readMcpAutomationBody,
  readMcpAutomationQuery,
  requireMcpAutomationParameter,
  runMcpAutomationRoute,
} from "@/app/lib/mcp-automation-route.server";

import type { McpAutomationHandlers } from "@/app/lib/mcp-automation-route.server";
import type { Route } from "./+types/api-mcp-v1-automation";

function handlers(params: Route.LoaderArgs["params"]): McpAutomationHandlers {
  // Read inside the handler, so a missing parameter is answered after the token check.
  const path = (): Readonly<Record<string, string>> => ({
    automationId: requireMcpAutomationParameter(params.automationId),
  });
  return {
    GET: async ({ automations, userId, request }) =>
      mcpAutomationResponse(
        await automations.read(userId, readMcpAutomationQuery(request, path())),
      ),
    PATCH: async ({ automations, userId, request }) =>
      mcpAutomationResponse(
        await automations.update(
          userId,
          await readMcpAutomationBody(request, path()),
        ),
      ),
  };
}

/**
 * Reads an automation (`GET /api/mcp/v1/automations/{automationId}`), PAGE-297.
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

/** Patches an automation (`PATCH`). */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpAutomationRoute(request, handlers(params));
}
