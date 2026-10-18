import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-definitions";

/** Read-only reusable content for the current user; administration and runner starts are separate. */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentExecutionError("accessDenied");
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (projectId !== null && (!projectId.trim() || projectId.length > 100))
      throw new AgentExecutionError("invalidInput");
    const services = await getApplicationServices();
    return Response.json(
      {
        agents: await services.agentProfileService.catalog(user.id, projectId),
      },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("agent_definitions", error);

    return agentFailureResponse(error);
  }
}
