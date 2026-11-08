import {
  mcpWikiResponse,
  requireMcpWikiParameter,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-page-version";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWikiHandlers {
  return {
    GET: async ({ api, context }) =>
      mcpWikiResponse(
        await api.lifecycle.version(
          context,
          requireMcpWikiParameter(params.id),
          requireMcpWikiParameter(params.versionId),
        ),
      ),
  };
}

/**
 * Reads one version of a page (`GET /api/mcp/v1/wiki/pages/{id}/versions/{versionId}`), PAGE-257 interface 9.
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
