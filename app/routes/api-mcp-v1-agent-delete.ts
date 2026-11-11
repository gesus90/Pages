import {
  mcpAgentResponse,
  readMcpAgentBody,
  requireMcpAgentParameter,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import { AgentDeletionRequest } from "@/backend/service/mcp/agent/AgentDeletionRequest";

import type { Route } from "./+types/api-mcp-v1-agent-delete";

/** Deletes an agent after an explicit request with a current preview. */
export async function action({
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  return runMcpAgentRoute(
    request,
    {
      POST: async ({ api, actor }) => {
        const input = AgentDeletionRequest.delete(
          await readMcpAgentBody(request),
        );
        return mcpAgentResponse(
          await api.deletions.delete(
            actor.userId,
            requireMcpAgentParameter(params.id),
            input.previewId,
            input.operationId,
          ),
        );
      },
    },
    { deletion: true },
  );
}
