import {
  mcpProjectResponse,
  readMcpProjectBody,
  runMcpProjectRoute,
} from "@/app/lib/mcp-project-route.server";
import { McpProjectRequest } from "@/backend/service/mcp/project/McpProjectRequest";

import type { McpProjectHandlers } from "@/app/lib/mcp-project-route.server";
import type { Route } from "./+types/api-mcp-v1-projects";

/** The methods of this resource. */
const HANDLERS: McpProjectHandlers = {
  GET: async ({ api, context, request }) =>
    mcpProjectResponse(
      await api.reads.overview(
        context,
        McpProjectRequest.overview(new URL(request.url).searchParams),
      ),
    ),
  POST: async ({ api, context, request }) => {
    const body = McpProjectRequest.create(await readMcpProjectBody(request));
    return mcpProjectResponse(
      { project: await api.writes.create(context, body) },
      201,
    );
  },
};

/**
 * Lists projects (`GET /api/mcp/v1/projects`) and creates one (`POST /api/mcp/v1/projects`), PAGE-244 interface 1 and 3.
 *
 * @remarks
 * Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpProjectRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpProjectRoute(request, HANDLERS);
}
