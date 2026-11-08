import {
  mcpWikiResponse,
  readMcpWikiBody,
  requireMcpWikiParameter,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";
import { McpWikiRequest } from "@/backend/service/mcp/wiki/McpWikiRequest";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-trash-restore";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWikiHandlers {
  return {
    POST: async ({ api, context, request }) => {
      McpWikiRequest.empty(await readMcpWikiBody(request));
      return mcpWikiResponse(
        await api.lifecycle.restore(
          context,
          requireMcpWikiParameter(params.id),
        ),
      );
    },
  };
}

/**
 * Brings a page back from the trash (`POST /api/mcp/v1/wiki/trash/{id}/restore`), PAGE-257 interface 13.
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
