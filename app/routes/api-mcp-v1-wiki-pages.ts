import {
  mcpWikiQuery,
  mcpWikiResponse,
  readMcpWikiBody,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";
import { McpWikiRequest } from "@/backend/service/mcp/wiki/McpWikiRequest";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-pages";

/** The methods of this resource. */
const HANDLERS: McpWikiHandlers = {
  GET: async ({ api, context, request }) =>
    mcpWikiResponse(
      await api.pages.tree(context, McpWikiRequest.tree(mcpWikiQuery(request))),
    ),
  POST: async ({ api, context, request }) => {
    const body = McpWikiRequest.create(await readMcpWikiBody(request));
    return mcpWikiResponse(await api.pages.create(context, body), 201);
  },
};

/**
 * Lists the page tree (`GET /api/mcp/v1/wiki/pages`) and creates a page (`POST`), PAGE-257 interface 1 and 4.
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
