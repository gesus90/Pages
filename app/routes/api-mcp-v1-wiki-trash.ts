import {
  mcpWikiResponse,
  runMcpWikiRoute,
} from "@/app/lib/mcp-wiki-route.server";

import type { McpWikiHandlers } from "@/app/lib/mcp-wiki-route.server";
import type { Route } from "./+types/api-mcp-v1-wiki-trash";

/** The methods of this resource. */
const HANDLERS: McpWikiHandlers = {
  GET: async ({ api, context }) =>
    mcpWikiResponse(await api.lifecycle.trash(context)),
};

/**
 * Lists the trash (`GET /api/mcp/v1/wiki/trash`), PAGE-257 interface 12.
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
