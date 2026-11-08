import {
  mcpWikiQuery,
  mcpWikiResponse,
  requireMcpWikiParameter,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";
import { toUploadedFile } from "@/app/lib/wiki-actions/wiki-upload.server";
import { McpWikiError } from "@/backend/service/mcp/wiki/McpWikiError";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-page-attachments";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWikiHandlers {
  return {
    GET: async ({ api, context }) =>
      mcpWikiResponse(
        await api.details.attachments(
          context,
          requireMcpWikiParameter(params.id),
        ),
      ),
    POST: async ({ api, context, request }) => {
      const name = mcpWikiQuery(request).get("name") ?? "";
      if (
        name.trim() === "" ||
        !request.headers
          .get("content-type")
          ?.startsWith("application/octet-stream")
      )
        throw new McpWikiError("invalid_request");
      // Streamed to the disk and counted while it arrives, like the upload
      // route of the interface, with the same limits of the instance.
      return mcpWikiResponse(
        await api.details.upload(
          context,
          requireMcpWikiParameter(params.id),
          toUploadedFile(request, name),
        ),
        201,
      );
    },
  };
}

/**
 * Lists the attachments of a page (`GET /api/mcp/v1/wiki/pages/{id}/attachments`) and takes a file (`POST …?name=<Dateiname>`), PAGE-257 interface 16.
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
