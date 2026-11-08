import {
  mcpWikiResponse,
  readMcpWikiBody,
  requireMcpWikiParameter,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";
import { McpWikiRequest } from "@/backend/service/mcp/wiki/McpWikiRequest";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-page-delete";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWikiHandlers {
  return {
    POST: async ({ api, context, request }) => {
      const body = McpWikiRequest.delete(await readMcpWikiBody(request));
      return mcpWikiResponse(
        await api.lifecycle.delete(
          context,
          requireMcpWikiParameter(params.id),
          body,
        ),
      );
    },
  };
}

/**
 * Moves a page into the trash after a confirmed question (`POST /api/mcp/v1/wiki/pages/{id}/delete`), PAGE-257 interface 11.
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
