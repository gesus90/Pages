import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-workspace-choices";

/** Read-only choices are reauthorized independently of administration or UI filters. */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("workspace_access_denied");
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (projectId !== null && (!projectId.trim() || projectId.length > 100))
      throw new AgentError("workspace_invalid");
    const services = await getApplicationServices();
    return Response.json(
      {
        workspaces: await services.agentWorkspaceService.choices(
          user.id,
          projectId,
        ),
      },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("agent_workspace_choices", error);

    return agentFailureResponse(error);
  }
}
