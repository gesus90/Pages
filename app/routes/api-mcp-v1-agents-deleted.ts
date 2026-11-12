import {
  mcpAgentResponse,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";
import { AgentDeletionRequest } from "@/backend/service/mcp/agent/AgentDeletionRequest";

import type { Route } from "./+types/api-mcp-v1-agents-deleted";

/** Lists agents restorable by an administrator. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runMcpAgentRoute(
    request,
    {
      GET: async ({ api, actor }) => {
        const input = AgentDeletionRequest.list(
          new URL(request.url).searchParams,
        );
        return mcpAgentResponse(
          await api.deletions.deleted(actor.userId, input.cursor, input.limit),
        );
      },
    },
    { deletion: true },
  );
}
