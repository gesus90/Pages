import {
  mcpAgentResponse,
  requireMcpAgentParameter,
  runMcpAgentRoute,
} from "@/app/lib/mcp-agent-route.server";

import type { Route } from "./+types/api-mcp-v1-agent-deletion-preview";

/** Returns a ten-minute preview before deleting an agent. */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  return runMcpAgentRoute(
    request,
    {
      GET: async ({ api, actor }) =>
        mcpAgentResponse(
          await api.deletions.preview(
            actor.userId,
            requireMcpAgentParameter(params.id),
          ),
        ),
    },
    { deletion: true },
  );
}
