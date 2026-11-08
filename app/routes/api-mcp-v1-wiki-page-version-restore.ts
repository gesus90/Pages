import {
  mcpWikiResponse,
  readMcpWikiBody,
  requireMcpWikiParameter,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";
import { McpWikiRequest } from "@/backend/service/mcp/wiki/McpWikiRequest";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-page-version-restore";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWikiHandlers {
  return {
    POST: async ({ api, context, request }) => {
      const body = McpWikiRequest.revision(await readMcpWikiBody(request));
      return mcpWikiResponse(
        await api.lifecycle.restoreVersion(
          context,
          requireMcpWikiParameter(params.id),
          requireMcpWikiParameter(params.versionId),
          body.expectedRevision,
        ),
      );
    },
  };
}

/**
 * Restores a version of a page (`POST /api/mcp/v1/wiki/pages/{id}/versions/{versionId}/restore`), PAGE-257 interface 9.
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
