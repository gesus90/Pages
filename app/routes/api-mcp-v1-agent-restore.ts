import {
  mcpAgentResponse,
  readMcpAgentBody,
  requireMcpAgentParameter,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import { AgentDeletionRequest } from "@/backend/service/mcp/agent/AgentDeletionRequest";

import type { Route } from "./+types/api-mcp-v1-agent-restore";

/** Restores an agent within the seven-day window; administrators only. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpAgentRoute(
    request,
    {
      POST: async ({ api, actor }) => {
        const input = AgentDeletionRequest.restore(
          await readMcpAgentBody(request),
        );
        return mcpAgentResponse(
          await api.deletions.restore(
            actor.userId,
            requireMcpAgentParameter(params.id),
            input.operationId,
          ),
        );
      },
    },
    { deletion: true },
  );
}
