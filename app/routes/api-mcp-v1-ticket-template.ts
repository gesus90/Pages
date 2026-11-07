import {
  mcpTicketResponse,
  readMcpTicketBody,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { McpTicketRequest } from "@/backend/service/mcp/ticket/McpTicketRequest";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-template";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    GET: async ({ api, context }) =>
      mcpTicketResponse({
        template: await api.catalog.readTemplate(
          context,
          requireMcpTicketParameter(params.templateId),
        ),
      }),
    PATCH: async ({ api, context, request }) => {
      const body = McpTicketRequest.templateUpdate(
        await readMcpTicketBody(request),
      );
      return mcpTicketResponse({
        template: await api.catalog.updateTemplate(
          context,
          requireMcpTicketParameter(params.templateId),
          body,
        ),
      });
    },
    DELETE: async ({ api, context }) => {
      await api.catalog.deleteTemplate(
        context,
        requireMcpTicketParameter(params.templateId),
      );
      return mcpTicketResponse({ deleted: true });
    },
  };
}

/**
 * Reads (`GET`), reshapes (`PATCH`) or deletes (`DELETE`) a template (`/api/mcp/v1/ticket-templates/{templateId}`), PAGE-242 interface 13.
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
