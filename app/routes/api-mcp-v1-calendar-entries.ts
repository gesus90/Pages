import {
  mcpCalendarQuery,
  mcpCalendarResponse,
  runMcpCalendarRoute,
} from "@/app/lib/mcp-calendar-route.server";
import { McpCalendarRequest } from "@/backend/service/mcp/calendar/McpCalendarRequest";

import type { McpCalendarHandlers } from "@/app/lib/mcp-calendar-route.server";
import type { Route } from "./+types/api-mcp-v1-calendar-entries";

/** The methods of this resource. */
const HANDLERS: McpCalendarHandlers = {
  GET: async ({ api, context, request }) =>
    mcpCalendarResponse(
      await api.reads.list(
        context,
        McpCalendarRequest.range(mcpCalendarQuery(request)),
      ),
    ),
};

/**
 * Lists the entries of a range of at most 92 days
 * (`GET /api/mcp/v1/calendar/entries?from=&to=&kinds=`, list_calendar), PAGE-301.
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
