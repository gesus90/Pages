import { Readable } from "node:stream";

import { contentDisposition } from "@/app/lib/content-disposition";
import {
  mcpTicketResponse,
  requireMcpTicketParameter,
  runMcpTicketRoute,
} from "@/app/lib/mcp-ticket-route.server";

import type { McpTicketHandlers } from "@/app/lib/mcp-ticket-route.server";
import type { Route } from "./+types/api-mcp-v1-ticket-attachment";

/** A downloaded file runs no script, whatever its type claims. */
const ATTACHMENT_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpTicketHandlers {
  return {
    GET: async ({ api, context }) => {
      const { attachment, stream } = await api.details.open(
        context,
        requireMcpTicketParameter(params.key),
        requireMcpTicketParameter(params.attachmentId),
      );
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": contentDisposition(
            "attachment",
            attachment.fileName,
          ),
          "Content-Length": String(attachment.size),
          "Content-Security-Policy": ATTACHMENT_CONTENT_SECURITY_POLICY,
          "Content-Type": attachment.contentType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
    DELETE: async ({ api, context }) =>
      mcpTicketResponse({
        ticket: await api.details.removeAttachment(
          context,
          requireMcpTicketParameter(params.key),
          requireMcpTicketParameter(params.attachmentId),
        ),
      }),
  };
}

/**
 * Sends a file of a ticket (`GET /api/mcp/v1/tickets/{key}/attachments/{attachmentId}`),
 * PAGE-242 interface 11.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The checks are
 * those of the download of the interface: a missing file and a file of a
 * hidden ticket answer alike.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpTicketRoute(request, handlers(params));
}

/** Removes a file of a ticket (`DELETE /api/mcp/v1/tickets/{key}/attachments/{attachmentId}`). */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpTicketRoute(request, handlers(params));
}
