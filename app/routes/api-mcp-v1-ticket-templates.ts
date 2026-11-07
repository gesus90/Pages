import {
  mcpTicketResponse,
  readMcpTicketBody,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-templates";

/** The methods of this resource. */
const HANDLERS: McpTicketHandlers = {
  POST: async ({ api, context, request }) => {
    const body = McpTicketRequest.templateCreate(
      await readMcpTicketBody(request),
    );
    return mcpTicketResponse(
      { template: await api.catalog.saveTemplate(context, body) },
      201,
    );
  },
};

/**
 * Saves a ticket as a template (`POST /api/mcp/v1/ticket-templates`), PAGE-242 interface 13.
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
