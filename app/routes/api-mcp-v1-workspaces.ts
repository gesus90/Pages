import {
  mcpWorkspaceResponse,
  readMcpWorkspaceBody,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-workspaces";

/** The methods of this resource. */
const HANDLERS: McpWorkspaceHandlers = {
  GET: async ({ api, actor, request }) =>
    mcpWorkspaceResponse(
      await api.workspaces.list(
        actor.userId,
        McpWorkspaceRequest.workspaceList(new URL(request.url).searchParams),
      ),
    ),
  POST: async ({ api, actor, request }) =>
    mcpWorkspaceResponse(
      await api.workspaces.create(
        actor.userId,
        McpWorkspaceRequest.workspaceCreate(
          await readMcpWorkspaceBody(request),
        ),
      ),
      201,
    ),
};

/**
 * Lists workspaces (`GET /api/mcp/v1/workspaces`) and registers one (`POST /api/mcp/v1/workspaces`), PAGE-245 interface 1 and 3.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, HANDLERS);
}
