import {
  mcpCalendarOutcomeResponse,
  readMcpCalendarBody,
  runMcpCalendarRoute,
} from "@/app/lib/mcp-calendar-route.server";
import { McpCalendarRequest } from "@/backend/service/mcp/calendar/McpCalendarRequest";

import type { McpCalendarHandlers } from "@/app/lib/mcp-calendar-route.server";
import type { Route } from "./+types/api-mcp-v1-calendar-events";

/** The methods of this resource. */
const HANDLERS: McpCalendarHandlers = {
  POST: async ({ api, context, request }) => {
    const body = McpCalendarRequest.create(await readMcpCalendarBody(request));
    return mcpCalendarOutcomeResponse(
      await api.writes.create(context, body),
      true,
    );
  },
};

/**
 * Creates an event of the account
 * (`POST /api/mcp/v1/calendar/events`, create_calendar_event), PAGE-301.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpCalendarRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpCalendarRoute(request, HANDLERS);
}
