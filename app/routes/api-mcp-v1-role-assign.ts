import {
  mcpUserChangeResponse,
  readMcpUserBody,
  requireMcpUserParameter,
  runMcpUserRoute,
} from "@/app/lib/mcp-user-route.server";
import { McpUserRequest } from "@/backend/service/mcp/users/McpUserRequest";

import type { McpUserHandlers } from "@/app/lib/mcp-user-route.server";
import type { Route } from "./+types/api-mcp-v1-role-assign";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpUserHandlers {
  const id = (): string => requireMcpUserParameter(params.roleId);
  return {
    POST: async ({ api, actor, request }) =>
      mcpUserChangeResponse(
        await api.change(
          actor,
          api.catalog.assignRole(
            id(),
            McpUserRequest.assign(await readMcpUserBody(request)),
          ),
        ),
      ),
  };
}

/**
 * Assigns a role to a person or all current members of a group or department (`POST /api/mcp/v1/roles/{roleId}/assign`), PAGE-280.
 *
 * @remarks
 * Only the device token of a paired machine admits a request; the rights of
 * its account are read again on every call. See `docs/McpUserManagement.md`.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpUserRoute(request, handlers(params));
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpUserRoute(request, handlers(params));
}
