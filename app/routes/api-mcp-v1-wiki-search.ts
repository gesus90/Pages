import {
  mcpWikiQuery,
  mcpWikiResponse,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";
import { McpWikiRequest } from "@/backend/service/mcp/wiki/McpWikiRequest";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-search";

/** The methods of this resource. */
const HANDLERS: McpWikiHandlers = {
  GET: async ({ api, context, request }) =>
    mcpWikiResponse(
      await api.pages.search(
        context,
        McpWikiRequest.search(mcpWikiQuery(request)),
      ),
    ),
};

/**
 * Searches the wiki like the search dialog (`GET /api/mcp/v1/wiki/search?text=…`), PAGE-257 interface 2.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpWikiRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpWikiRoute(request, HANDLERS);
}
