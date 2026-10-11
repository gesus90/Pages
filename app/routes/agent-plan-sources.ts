import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Route } from "./+types/agent-plan-sources";

/** Reloads the two source sets only after authorizing the selected workspace and its project. */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const workspaceId = readPlanText(
      new URL(request.url).searchParams.get("workspaceId"),
    );
    const services = await getApplicationServices();
    return Response.json(
      {
        workspaceId,
        sources: await services.agentPlanService.sources(user.id, workspaceId),
      },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    return agentFailureResponse(error);
  }
}
