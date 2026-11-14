import {
  mcpCalendarQuery,
  mcpCalendarResponse,
  runMcpCalendarRoute,
} from "@/app/lib/mcp-calendar-route.server";
import { McpCalendarRequest } from "@/backend/service/mcp/calendar/McpCalendarRequest";

import type { McpCalendarHandlers } from "@/app/lib/mcp-calendar-route.server";
import type { Route } from "./+types/api-mcp-v1-calendar-options";

/** The methods of this resource. */
const HANDLERS: McpCalendarHandlers = {
  GET: async ({ api, context, request }) => {
    McpCalendarRequest.empty(mcpCalendarQuery(request));
    return mcpCalendarResponse(await api.reads.options(context));
  },
};

/**
 * Reads the zone, calendars, rule choices and limits of the account
 * (`GET /api/mcp/v1/calendar/options`, read_calendar_options), PAGE-301.
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
