import {
  mcpWorkspaceResponse,
  readMcpWorkspaceBody,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-remote-connection-test";

/** The methods of this resource. */
const HANDLERS: McpWorkspaceHandlers = {
  POST: async ({ api, actor, request }) =>
    mcpWorkspaceResponse(
      await api.connections.test(
        actor.userId,
        McpWorkspaceRequest.connectionTest(await readMcpWorkspaceBody(request)),
      ),
    ),
};

/**
 * Tests a connection without storing it (`POST /api/mcp/v1/remote-connections/test`), PAGE-245 interface 11.
 *
 * @remarks
 * Only the device token of a paired machine admits a request, and only for
 * an account with the administrator role.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, HANDLERS);
}
