import {
  mcpWikiQuery,
  mcpWikiResponse,
  readMcpWikiBody,
  requireMcpWikiParameter,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";
import { McpWikiRequest } from "@/backend/service/mcp/wiki/McpWikiRequest";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-page";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpWikiHandlers {
  return {
    GET: async ({ api, context, request }) => {
      const { withBacklinks } = McpWikiRequest.read(mcpWikiQuery(request));
      return mcpWikiResponse(
        await api.pages.read(
          context,
          requireMcpWikiParameter(params.id),
          withBacklinks,
        ),
      );
    },
    PATCH: async ({ api, context, request }) => {
      const body = McpWikiRequest.update(await readMcpWikiBody(request));
      return mcpWikiResponse(
        await api.pages.update(
          context,
          requireMcpWikiParameter(params.id),
          body,
        ),
      );
    },
  };
}

/**
 * Reads a page (`GET /api/mcp/v1/wiki/pages/{id}`) and changes it (`PATCH`), PAGE-257 interface 3 and 5.
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
