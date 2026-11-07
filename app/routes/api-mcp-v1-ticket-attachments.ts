import {
  mcpTicketResponse,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";
import { toUploadedFile } from "@/app/lib/wiki-actions/wiki-upload.server";
import { McpTicketError } from "@/backend/service/mcp/ticket/McpTicketError";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-attachments";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    POST: async ({ api, context, request }) => {
      const name = new URL(request.url).searchParams.get("name") ?? "";
      if (
        name.trim() === "" ||
        !request.headers
          .get("content-type")
          ?.startsWith("application/octet-stream")
      )
        throw new McpTicketError("invalid_request");
      // Streamed to the disk and counted while it arrives, like the upload
      // route of the interface, with the same limits of the instance.
      const result = await api.details.upload(
        context,
        requireMcpTicketParameter(params.key),
        toUploadedFile(request, name),
      );
      return mcpTicketResponse(result, 201);
    },
  };
}

/**
 * Takes a file for a ticket (`POST /api/mcp/v1/tickets/{key}/attachments?name=<Dateiname>`),
 * PAGE-242 interface 11.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The body is
 * the file itself with `Content-Type: application/octet-stream`.
 */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpTicketRoute(request, handlers(params));
}

/** Answers the reading methods of the same resource, which it does not serve. */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpTicketRoute(request, handlers(params));
}
