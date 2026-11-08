import {
  mcpWikiResponse,
  readMcpWikiBody,
  requireMcpWikiParameter,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";
import { McpWikiRequest } from "@/backend/service/mcp/wiki/McpWikiRequest";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-page-properties";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWikiHandlers {
  return {
    PATCH: async ({ api, context, request }) => {
      const body = McpWikiRequest.properties(await readMcpWikiBody(request));
      return mcpWikiResponse(
        await api.pages.setProperties(
          context,
          requireMcpWikiParameter(params.id),
          body,
        ),
      );
    },
  };
}

/**
 * Changes owner, review date and anchors of a page (`PATCH /api/mcp/v1/wiki/pages/{id}/properties`), PAGE-257 interface 8.
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
