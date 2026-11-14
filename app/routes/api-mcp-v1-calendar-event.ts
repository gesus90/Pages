import {
  mcpCalendarOutcomeResponse,
  mcpCalendarQuery,
  mcpCalendarResponse,
  readMcpCalendarBody,
  runMcpCalendarRoute,
} from "@/app/lib/mcp-calendar-route.server";
import { McpCalendarRequest } from "@/backend/service/mcp/calendar/McpCalendarRequest";

import type { McpCalendarHandlers } from "@/app/lib/mcp-calendar-route.server";
import type { Route } from "./+types/api-mcp-v1-calendar-event";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpCalendarHandlers {
  return {
    GET: async ({ api, context, request }) => {
      McpCalendarRequest.empty(mcpCalendarQuery(request));
      return mcpCalendarResponse(
        await api.reads.read(
          context,
          McpCalendarRequest.eventId(params.eventId),
        ),
      );
    },
    PATCH: async ({ api, context, request }) => {
      const eventId = McpCalendarRequest.eventId(params.eventId);
      const body = McpCalendarRequest.update(
        await readMcpCalendarBody(request),
      );
      return mcpCalendarOutcomeResponse(
        await api.writes.update(context, eventId, body),
      );
    },
  };
}

/**
 * Reads an event (`GET /api/mcp/v1/calendar/events/{id}`, read_calendar_event)
 * and changes it (`PATCH`, update_calendar_event), PAGE-301.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpCalendarRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpCalendarRoute(request, handlers(params));
}
