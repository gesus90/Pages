import {
  mcpWikiResponse,
  readMcpWikiBody,
  requireMcpWikiParameter,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";
import { McpWikiRequest } from "@/backend/service/mcp/wiki/McpWikiRequest";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-page-comments";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWikiHandlers {
  return {
    GET: async ({ api, context }) =>
      mcpWikiResponse(
        await api.details.comments(context, requireMcpWikiParameter(params.id)),
      ),
    POST: async ({ api, context, request }) => {
      const body = McpWikiRequest.commentCreate(await readMcpWikiBody(request));
      return mcpWikiResponse(
        await api.details.addComment(
          context,
          requireMcpWikiParameter(params.id),
          body,
        ),
        201,
      );
    },
  };
}

/**
 * Lists the comments of a page (`GET /api/mcp/v1/wiki/pages/{id}/comments`) and adds one (`POST`), PAGE-257 interface 15.
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
