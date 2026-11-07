import {
  mcpTicketResponse,
  readMcpTicketBody,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-tickets";

/** The methods of this resource. */
const HANDLERS: McpTicketHandlers = {
  GET: async ({ api, context, request }) =>
    mcpTicketResponse(
      await api.reads.search(
        context,
        McpTicketRequest.search(new URL(request.url).searchParams),
      ),
    ),
  POST: async ({ api, context, request }) => {
    const body = McpTicketRequest.create(await readMcpTicketBody(request));
    return mcpTicketResponse(
      { ticket: await api.writes.create(context, body) },
      201,
    );
  },
};

/**
 * Searches tickets (`GET /api/mcp/v1/tickets?projectId=<ID>`) and creates one (`POST /api/mcp/v1/tickets`), PAGE-242 interface 2 and 5.
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
