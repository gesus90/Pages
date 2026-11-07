import {
  mcpTicketResponse,
  readMcpTicketBody,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-links";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    POST: async ({ api, context, request }) => {
      const body = McpTicketRequest.link(await readMcpTicketBody(request));
      return mcpTicketResponse(
        {
          ticket: await api.details.addLink(
            context,
            requireMcpTicketParameter(params.key),
            body,
          ),
        },
        201,
      );
    },
  };
}

/**
 * Links a ticket with another one (`POST /api/mcp/v1/tickets/{key}/links`), PAGE-242 interface 10.
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
