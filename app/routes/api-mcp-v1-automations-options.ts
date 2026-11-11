import {
  mcpAutomationResponse,
  readMcpAutomationQuery,
  runMcpAutomationRoute,
} from "@/app/lib/mcp-automation-route.server";
import {
  readAutomationInput,
  optionsInputSchema,
} from "@/backend/service/automation/AutomationInput";

import type { McpAutomationHandlers } from "@/app/lib/mcp-automation-route.server";
import type { Route } from "./+types/api-mcp-v1-automations-options";

const HANDLERS: McpAutomationHandlers = {
  GET: async ({ automations, userId, request }) => {
    readAutomationInput(optionsInputSchema, readMcpAutomationQuery(request));
    return mcpAutomationResponse(await automations.options(userId));
  },
};

/**
 * Reads what the paired account may choose (`GET /api/mcp/v1/automations/options`), PAGE-297.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpAutomationRoute(request, HANDLERS);
}

/** Refuses every other method. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpAutomationRoute(request, HANDLERS);
}
