import {
  mcpUserResponse,
  runMcpUserRoute,
} from "@/app/lib/mcp-user-route.server";

import type { McpUserHandlers } from "@/app/lib/mcp-user-route.server";
import type { Route } from "./+types/api-mcp-v1-administration-options";

/** The methods of this resource. */
const HANDLERS: McpUserHandlers = {
  GET: async ({ api, actor }) =>
    mcpUserResponse(
      await api.read(actor, (session) => api.reads.options(session)),
    ),
};

/**
 * Reads the permission catalog, the choices and the actions the account may take now (`GET /api/mcp/v1/administration/options`), PAGE-280.
 *
 * @remarks
 * Only the device token of a paired machine admits a request; the rights of
 * its account are read again on every call. See `docs/McpUserManagement.md`.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpUserRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpUserRoute(request, HANDLERS);
}
