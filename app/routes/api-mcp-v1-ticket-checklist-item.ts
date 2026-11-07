import {
  mcpTicketResponse,
  readMcpTicketBody,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-checklist-item";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    PATCH: async ({ api, context, request }) => {
      const { isDone } = McpTicketRequest.checklistUpdate(
        await readMcpTicketBody(request),
      );
      return mcpTicketResponse({
        ticket: await api.details.setChecklistItemDone(
          context,
          requireMcpTicketParameter(params.key),
          requireMcpTicketParameter(params.itemId),
          isDone,
        ),
      });
    },
    DELETE: async ({ api, context }) =>
      mcpTicketResponse({
        ticket: await api.details.deleteChecklistItem(
          context,
          requireMcpTicketParameter(params.key),
          requireMcpTicketParameter(params.itemId),
        ),
      }),
  };
}

/**
 * Checks, reopens (`PATCH`) or deletes (`DELETE`) an acceptance criterion (`/api/mcp/v1/tickets/{key}/checklist/{itemId}`), PAGE-242 interface 9.
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
