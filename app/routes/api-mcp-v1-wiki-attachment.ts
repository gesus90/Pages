import { Readable } from "node:stream";

import { contentDisposition } from "@/app/lib/content-disposition";
import {
  mcpWikiResponse,
  requireMcpWikiParameter,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-attachment";

/** A downloaded file runs no script, whatever its type claims. */
const ATTACHMENT_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWikiHandlers {
  return {
    GET: async ({ api, context }) => {
      const { attachment, stream } = await api.details.open(
        context,
        requireMcpWikiParameter(params.attachmentId),
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
      mcpWikiResponse(
        await api.details.removeAttachment(
          context,
          requireMcpWikiParameter(params.attachmentId),
        ),
      ),
  };
}

/**
 * Sends the bytes of an attachment (`GET /api/mcp/v1/wiki/attachments/{attachmentId}`) and removes it (`DELETE`), PAGE-257 interface 16.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpWikiRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpWikiRoute(request, handlers(params));
}
