import {
  mcpAutomationResponse,
  readMcpAutomationBody,
  readMcpAutomationQuery,
  runMcpAutomationRoute,
} from "@/app/lib/mcp-automation-route.server";

import type { McpAutomationHandlers } from "@/app/lib/mcp-automation-route.server";
import type { Route } from "./+types/api-mcp-v1-automations";

const HANDLERS: McpAutomationHandlers = {
  GET: async ({ automations, userId, request }) =>
    mcpAutomationResponse(
      await automations.list(userId, readMcpAutomationQuery(request)),
    ),
  POST: async ({ automations, userId, request }) =>
    mcpAutomationResponse(
      await automations.create(userId, await readMcpAutomationBody(request)),
      201,
    ),
};

/**
 * Lists the visible automations (`GET /api/mcp/v1/automations`), PAGE-297.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpAutomationRoute(request, HANDLERS);
}

/** Creates an automation of the paired account (`POST`). */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpAutomationRoute(request, HANDLERS);
}
