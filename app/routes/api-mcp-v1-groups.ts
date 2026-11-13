import { runManagementRoute } from "@/app/lib/management-route.server";
import {
  mcpUserChangeResponse,
  mcpUserQuery,
  mcpUserResponse,
  readMcpUserBody,
  runMcpUserRoute,
} from "@/app/lib/mcp-user-route.server";
import { McpUserRequest } from "@/backend/service/mcp/users/McpUserRequest";

import type { McpUserHandlers } from "@/app/lib/mcp-user-route.server";
import type { Route } from "./+types/api-mcp-v1-groups";

/** The methods of this resource. */
const HANDLERS: McpUserHandlers = {
  GET: async ({ api, actor, request }) =>
    mcpUserResponse(
      await api.read(actor, (session) =>
        api.reads.groups(session, McpUserRequest.list(mcpUserQuery(request))),
      ),
    ),
  POST: async ({ api, actor, request }) =>
    mcpUserChangeResponse(
      await api.change(
        actor,
        api.catalog.createGroup(
          McpUserRequest.groupCreate(await readMcpUserBody(request)),
        ),
      ),
      true,
    ),
};

/**
 * Lists the groups (`GET /api/mcp/v1/groups`) and creates one (`POST`), PAGE-280.
 *
 * @remarks
 * Only the device token of a paired machine admits a request; the rights of
 * its account are read again on every call. See `docs/McpUserManagement.md`.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  if (request.method === "POST")
    return runManagementRoute(request, "groups_create");
  return runMcpUserRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  if (request.method === "POST")
    return runManagementRoute(request, "groups_create");
  return runMcpUserRoute(request, HANDLERS);
}
