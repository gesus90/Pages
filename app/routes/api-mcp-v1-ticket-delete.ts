import {
  mcpTicketResponse,
  readMcpTicketBody,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-delete";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    POST: async ({ api, context, request }) => {
      const body = McpTicketRequest.lifecycle(await readMcpTicketBody(request));
      return mcpTicketResponse(
        await api.lifecycle.delete(
          context,
          requireMcpTicketParameter(params.key),
          body,
        ),
      );
    },
  };
}

/**
 * Deletes a ticket for good after a confirmed question; administrators only (`POST /api/mcp/v1/tickets/{key}/delete`), PAGE-242 interface 16.
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
