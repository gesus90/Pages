import {
  mcpTicketResponse,
  readMcpTicketBody,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-label";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    PATCH: async ({ api, context, request }) => {
      const body = McpTicketRequest.labelUpdate(
        await readMcpTicketBody(request),
      );
      return mcpTicketResponse({
        label: await api.catalog.updateLabel(
          context,
          requireMcpTicketParameter(params.labelId),
          body,
        ),
      });
    },
  };
}

/**
 * Renames or recolors a label (`PATCH /api/mcp/v1/ticket-labels/{labelId}`), PAGE-242 interface 12.
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
