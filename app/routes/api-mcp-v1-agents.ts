import {
  mcpAgentResponse,
  readMcpAgentBody,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import { McpAgentRequest } from "@/backend/service/mcp/agent/McpAgentRequest";

import type { McpAgentHandlers } from "@/app/lib/mcp-agent-route.server";
import type { Route } from "./+types/api-mcp-v1-agents";

/** The methods of this resource. */
const HANDLERS: McpAgentHandlers = {
  GET: async ({ api, actor, request }) =>
    mcpAgentResponse(
      await api.agents.list(
        actor.userId,
        McpAgentRequest.list(new URL(request.url).searchParams),
      ),
    ),
  POST: async ({ api, actor, request }) =>
    mcpAgentResponse(
      await api.agents.create(
        actor.userId,
        McpAgentRequest.create(await readMcpAgentBody(request)),
      ),
      201,
    ),
};

/**
 * Searches agents (`GET /api/mcp/v1/agents?text=&status=active|inactive`) and creates one (`POST`), PAGE-267.
 *
 * @remarks
 * Only the device token of a paired machine admits a request, and only for
 * an account with the administrator role. A new agent appears in the
 * agents tab of the user administration at once.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpAgentRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpAgentRoute(request, HANDLERS);
}
