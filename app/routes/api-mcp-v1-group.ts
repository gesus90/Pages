import {
  mcpUserChangeResponse,
  mcpUserResponse,
  readMcpUserBody,
  requireMcpUserParameter,
  runMcpUserRoute,
} from "@/app/lib/mcp-user-route.server";
import {
  isAdministrationView,
  runMcpAgentProfileRoute,
} from "@/app/lib/mcp-agent-profile-route.server";
import { McpAgentProfileRequest } from "@/backend/service/mcp/agent/McpAgentProfileRequest";
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
 * Reads a group with its leaders and members (`GET /api/mcp/v1/groups/{groupId}`, PAGE-308), the group of the user management
 * (`GET /api/mcp/v1/groups/{groupId}?view=administration`), changes it (`PATCH`) and deletes it (`DELETE`), PAGE-280.
 *
 * @remarks
 * The profile read answers an administrator and every member of the group.
 * The administration view, `PATCH` and `DELETE` need the device token of a
 * paired machine; the rights of its account are read again on every call.
 * See `docs/McpUserManagement.md`.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  if (isAdministrationView(request))
    return runMcpUserRoute(request, handlers(params));
  return runMcpAgentProfileRoute(request, ({ api, actor }) =>
    api.profiles.group(
      actor.userId,
      McpAgentProfileRequest.identifier(params.groupId, "groupId"),
    ),
  );
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpUserRoute(request, handlers(params));
}
