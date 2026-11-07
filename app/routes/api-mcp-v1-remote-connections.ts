import {
  mcpWorkspaceResponse,
  readMcpWorkspaceBody,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-remote-connections";

/** The methods of this resource. */
const HANDLERS: McpWorkspaceHandlers = {
  GET: async ({ api, actor }) =>
    mcpWorkspaceResponse(await api.connections.list(actor.userId)),
  POST: async ({ api, actor, request }) =>
    mcpWorkspaceResponse(
      await api.connections.create(
        actor.userId,
        McpWorkspaceRequest.connectionCreate(
          await readMcpWorkspaceBody(request),
        ),
      ),
      201,
    ),
};

/**
 * Lists remote connections (`GET /api/mcp/v1/remote-connections`) and creates one (`POST`), PAGE-245 interface 9 and 12.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. Creating needs the administrator role.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, HANDLERS);
}
