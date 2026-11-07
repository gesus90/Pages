import {
  mcpTicketResponse,
  readMcpTicketBody,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    GET: async ({ api, context }) =>
      mcpTicketResponse({
        ticket: await api.reads.read(
          context,
          requireMcpTicketParameter(params.key),
        ),
      }),
    PATCH: async ({ api, context, request }) => {
      const body = McpTicketRequest.patch(await readMcpTicketBody(request));
      return mcpTicketResponse({
        ticket: await api.writes.patch(
          context,
          requireMcpTicketParameter(params.key),
          body,
        ),
      });
    },
  };
}

/**
 * Reads a ticket (`GET /api/mcp/v1/tickets/{key}`) and changes it (`PATCH`), PAGE-242 interface 3 and 6.
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
