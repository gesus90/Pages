import {
  mcpUserChangeResponse,
  mcpUserResponse,
  readMcpUserBody,
  requireMcpUserParameter,
  runMcpUserRoute,
} from "@/app/lib/mcp-user-route.server";
import { McpUserRequest } from "@/backend/service/mcp/users/McpUserRequest";

import type { McpUserHandlers } from "@/app/lib/mcp-user-route.server";
import type { Route } from "./+types/api-mcp-v1-department";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpUserHandlers {
  const id = (): string => requireMcpUserParameter(params.departmentId);
  return {
    GET: async ({ api, actor }) =>
      mcpUserResponse(
        await api.read(actor, (session) => api.reads.department(session, id())),
      ),
    PATCH: async ({ api, actor, request }) =>
      mcpUserChangeResponse(
        await api.change(
          actor,
          api.catalog.updateDepartment(
            id(),
            McpUserRequest.departmentUpdate(await readMcpUserBody(request)),
          ),
        ),
      ),
    DELETE: async ({ api, actor, request }) =>
      mcpUserChangeResponse(
        await api.change(
          actor,
          api.catalog.deleteDepartment(
            id(),
            McpUserRequest.membersDelete(await readMcpUserBody(request)),
          ),
        ),
      ),
  };
}

/**
 * Reads a department (`GET /api/mcp/v1/departments/{departmentId}`), renames it (`PATCH`) and deletes it (`DELETE`), PAGE-280.
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
