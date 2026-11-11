import {
  mcpAgentResponse,
  readMcpAgentBody,
  requireMcpAgentParameter,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import {
  isAdministrationView,
  runMcpAgentProfileRoute,
} from "@/app/lib/mcp-agent-profile-route.server";
import { McpAgentProfileRequest } from "@/backend/service/mcp/agent/McpAgentProfileRequest";
import { McpAgentRequest } from "@/backend/service/mcp/agent/McpAgentRequest";

import type { McpAgentHandlers } from "@/app/lib/mcp-agent-route.server";
import type { Route } from "./+types/api-mcp-v1-agent";

/** The methods of this resource for the parameters of the request. */
function handlers(params: Route.LoaderArgs["params"]): McpAgentHandlers {
  return {
    GET: async ({ api, actor }) =>
      mcpAgentResponse(
        await api.agents.read(
          actor.userId,
          requireMcpAgentParameter(params.id),
        ),
      ),
    PATCH: async ({ api, actor, request }) =>
      mcpAgentResponse(
        await api.agents.update(
          actor.userId,
          requireMcpAgentParameter(params.id),
          McpAgentRequest.update(await readMcpAgentBody(request)),
        ),
      ),
  };
}

/**
 * Reads an agent profile (`GET /api/mcp/v1/agents/{agentId}`, PAGE-308), the agent of the administration
 * (`GET /api/mcp/v1/agents/{id}?view=administration`) and changes it (`PATCH`), PAGE-267.
 *
 * @remarks
 * The profile answers every account that may read it: administrators, the
 * leaders of a group of the agent and the managers of a project of the
 * agent. The administration view and `PATCH` stay with administrators; a
 * change needs the current `revision`, and `isActive: false` deactivates an
 * agent that is not running.
 */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  if (isAdministrationView(request))
    return runMcpAgentRoute(request, handlers(params));
  return runMcpAgentProfileRoute(request, ({ api, actor }) =>
    api.profiles.read(
      actor.userId,
      McpAgentProfileRequest.identifier(params.id, "agentId"),
    ),
  );
}

/** Serves the changing methods of the same resource. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpAgentRoute(request, handlers(params));
}
