import {
  mcpAgentResponse,
  readMcpAgentBody,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import {
  administrationQuery,
  isAdministrationView,
  runMcpAgentProfileRoute,
} from "@/app/lib/mcp-agent-profile-route.server";
import { McpAgentProfileRequest } from "@/backend/service/mcp/agent/McpAgentProfileRequest";
import { McpAgentRequest } from "@/backend/service/mcp/agent/McpAgentRequest";

import type { McpAgentHandlers } from "@/app/lib/mcp-agent-route.server";
import type { Route } from "./+types/api-mcp-v1-agents";

/** The methods of this resource. */
const HANDLERS: McpAgentHandlers = {
  GET: async ({ api, actor, request }) =>
    mcpAgentResponse(
      await api.agents.list(
        actor.userId,
        McpAgentRequest.list(administrationQuery(request)),
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
 * Lists the readable agent profiles (`GET /api/mcp/v1/agents`, PAGE-308), searches agents for the administration
 * (`GET /api/mcp/v1/agents?view=administration&text=&status=active|inactive`) and creates one (`POST`), PAGE-267.
 *
 * @remarks
 * Only the device token of a paired machine admits a request. The profile
 * list answers every account with the agents it may read: all for an
 * administrator, the agents of its groups and projects for a leader. The
 * administration view and `POST` stay with administrators. A new agent
 * appears in the agents tab of the user administration at once.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  if (isAdministrationView(request)) return runMcpAgentRoute(request, HANDLERS);
  return runMcpAgentProfileRoute(request, ({ api, actor }) =>
    api.profiles.list(
      actor.userId,
      McpAgentProfileRequest.list(new URL(request.url).searchParams),
    ),
  );
}

/** Serves the changing methods of the same resource. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runMcpAgentRoute(request, HANDLERS);
}
