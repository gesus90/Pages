import {
  mcpWorkspaceResponse,
  runMcpWorkspaceRoute,
} from "@/app/lib/mcp-workspace-route.server";
import { McpWorkspaceRequest } from "@/backend/service/mcp/workspace/McpWorkspaceRequest";

import type { McpWorkspaceHandlers } from "@/app/lib/mcp-workspace-route.server";
import type { Route } from "./+types/api-mcp-v1-workspace-folders";

/** The methods of this resource. */
const HANDLERS: McpWorkspaceHandlers = {
  GET: async ({ api, actor, request }) =>
    mcpWorkspaceResponse(
      await api.workspaces.folders(
        actor.userId,
        McpWorkspaceRequest.folders(new URL(request.url).searchParams),
      ),
    ),
};

/**
 * Browses the local folders of the server (`GET /api/mcp/v1/workspaces/folders`), PAGE-245 interface 8.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. Folders of
 * remote machines cannot be browsed.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, HANDLERS);
}

/** Answers every changing method with `405`, as the resource only reads. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpWorkspaceRoute(request, HANDLERS);
}
