import {
  mcpUserChangeResponse,
  mcpUserResponse,
  readMcpUserBody,
  requireMcpUserParameter,
  runMcpUserRoute,
} from "@/app/lib/mcp-user-route.server";
import { McpUserRequest } from "@/backend/service/mcp/users/McpUserRequest";

import type { McpUserHandlers } from "@/app/lib/mcp-user-route.server";
import type { Route } from "./+types/api-mcp-v1-group";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpUserHandlers {
  const id = (): string => requireMcpUserParameter(params.groupId);
  return {
    GET: async ({ api, actor }) =>
      mcpUserResponse(
        await api.read(actor, (session) => api.reads.group(session, id())),
      ),
    PATCH: async ({ api, actor, request }) =>
      mcpUserChangeResponse(
        await api.change(
          actor,
          api.catalog.updateGroup(
            id(),
            McpUserRequest.groupUpdate(await readMcpUserBody(request)),
          ),
        ),
      ),
    DELETE: async ({ api, actor, request }) =>
      mcpUserChangeResponse(
        await api.change(
          actor,
          api.catalog.deleteGroup(
            id(),
            McpUserRequest.membersDelete(await readMcpUserBody(request)),
          ),
        ),
      ),
  };
}

/**
 * Reads a group (`GET /api/mcp/v1/groups/{groupId}`), changes it (`PATCH`) and deletes it (`DELETE`), PAGE-280.
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
