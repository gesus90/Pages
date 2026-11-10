import {
  mcpUserQuery,
  mcpUserResponse,
  requireMcpUserParameter,
  runMcpUserRoute,
} from "@/app/lib/mcp-user-route.server";
import { McpUserRequest } from "@/backend/service/mcp/users/McpUserRequest";

import type { McpUserHandlers } from "@/app/lib/mcp-user-route.server";
import type { Route } from "./+types/api-mcp-v1-user-private-wiki";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpUserHandlers {
  const id = (): string => requireMcpUserParameter(params.userId);
  return {
    GET: async ({ api, actor, request, wiki }) =>
      mcpUserResponse(
        await api.read(actor, (session) =>
          api.reads.privateWikiPages(
            session,
            { actor, wiki },
            id(),
            McpUserRequest.list(mcpUserQuery(request)),
          ),
        ),
      ),
  };
}

/**
 * Lists the private wiki pages of an account as placeholders (`GET /api/mcp/v1/users/{userId}/private-wiki`), PAGE-280.
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
