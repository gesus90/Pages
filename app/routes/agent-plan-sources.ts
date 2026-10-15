import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
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
    const agentId = new URL(request.url).searchParams.get("agentId");
    if (agentId !== null) {
      const sourceId = readPlanText(agentId);
      const agents = await services.agentPlanService.agents(
        user.id,
        workspaceId,
      );
      const agent = agents.find((entry) => entry.id === sourceId);
      if (!agent?.availability.isUsable)
        throw new AgentError("agent_usage_denied");
      return Response.json(copyPlanConfiguration(agent), {
        headers: AGENT_NO_STORE,
      });
    }
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
