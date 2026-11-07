import {
  mcpTicketResponse,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-link";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    DELETE: async ({ api, context }) =>
      mcpTicketResponse({
        ticket: await api.details.removeLink(
          context,
          requireMcpTicketParameter(params.key),
          requireMcpTicketParameter(params.linkId),
        ),
      }),
  };
}

/**
 * Removes a link of a ticket (`DELETE /api/mcp/v1/tickets/{key}/links/{linkId}`), PAGE-242 interface 10.
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
