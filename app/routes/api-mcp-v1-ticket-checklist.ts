import {
  mcpTicketResponse,
  readMcpTicketBody,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-checklist";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    POST: async ({ api, context, request }) => {
      const { title } = McpTicketRequest.checklistCreate(
        await readMcpTicketBody(request),
      );
      return mcpTicketResponse(
        {
          ticket: await api.details.addChecklistItem(
            context,
            requireMcpTicketParameter(params.key),
            title,
          ),
        },
        201,
      );
    },
  };
}

/**
 * Appends an acceptance criterion (`POST /api/mcp/v1/tickets/{key}/checklist`), PAGE-242 interface 9.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpTicketRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpTicketRoute(request, handlers(params));
}
