import {
  mcpCalendarQuery,
  mcpCalendarResponse,
  runMcpCalendarRoute,
} from "@/app/lib/mcp-calendar-route.server";
import { McpCalendarRequest } from "@/backend/service/mcp/calendar/McpCalendarRequest";

import type { McpCalendarHandlers } from "@/app/lib/mcp-calendar-route.server";
import type { Route } from "./+types/api-mcp-v1-calendar-invitees";

/** The methods of this resource. */
const HANDLERS: McpCalendarHandlers = {
  GET: async ({ api, context, request }) =>
    mcpCalendarResponse(
      await api.reads.invitees(
        context,
        McpCalendarRequest.invitees(mcpCalendarQuery(request)),
      ),
    ),
};

/**
 * Searches whom the account may invite
 * (`GET /api/mcp/v1/calendar/invitees?text=&limit=`, search_calendar_invitees), PAGE-301.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpCalendarRoute(request, HANDLERS);
}

/** Answers other methods of the same resource with `405`. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpCalendarRoute(request, HANDLERS);
}
