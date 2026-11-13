import {
  mcpCalendarOutcomeResponse,
  readMcpCalendarBody,
  runMcpCalendarRoute,
} from "@/app/lib/mcp-calendar-route.server";
import { McpCalendarRequest } from "@/backend/service/mcp/calendar/McpCalendarRequest";

import type { McpCalendarHandlers } from "@/app/lib/mcp-calendar-route.server";
import type { Route } from "./+types/api-mcp-v1-calendar-event-response";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpCalendarHandlers {
  return {
    POST: async ({ api, context, request }) => {
      const eventId = McpCalendarRequest.eventId(params.eventId);
      const body = McpCalendarRequest.respond(
        await readMcpCalendarBody(request),
      );
      return mcpCalendarOutcomeResponse(
        await api.writes.respond(context, eventId, body),
      );
    },
  };
}

/**
 * Answers an invitation for the whole series
 * (`POST /api/mcp/v1/calendar/events/{id}/response`, respond_calendar_event), PAGE-301.
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
