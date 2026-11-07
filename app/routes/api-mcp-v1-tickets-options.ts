import {
  mcpTicketResponse,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-tickets-options";

/** The methods of this resource. */
const HANDLERS: McpTicketHandlers = {
  GET: async ({ api, context, request }) => {
    const { projectId } = McpTicketRequest.options(
      new URL(request.url).searchParams,
    );
    return mcpTicketResponse(await api.reads.options(context, projectId));
  },
};

/**
 * Returns the choices of a project (`GET /api/mcp/v1/tickets/options?projectId=<ID>`), PAGE-242 interface 1.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpTicketRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpTicketRoute(request, HANDLERS);
}
