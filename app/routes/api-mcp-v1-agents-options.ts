import {
  mcpAgentResponse,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import { McpAgentRequest } from "@/backend/service/mcp/agent/McpAgentRequest";

import type { McpAgentHandlers } from "@/app/lib/mcp-agent-route.server";
import type { Route } from "./+types/api-mcp-v1-agents-options";

/** The methods of this resource. */
const HANDLERS: McpAgentHandlers = {
  GET: async ({ api, actor, request }) => {
    McpAgentRequest.empty(new URL(request.url).searchParams);
    return mcpAgentResponse(await api.agents.options(actor.userId));
  },
};

/**
 * Lists the choices of an agent (`GET /api/mcp/v1/agents/options`), PAGE-267.
 *
 * @remarks
 * Only the device token of a paired machine admits a request, and only for
 * an account with the administrator role. The models are exactly the
 * language models with tools the agents tab offers.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpAgentRoute(request, HANDLERS);
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpAgentRoute(request, HANDLERS);
}
