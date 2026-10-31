import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  planCatalogRefresh,
  planCatalogResponse,
} from "@/app/lib/agent-plan-catalog.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-plan-sources";

/** Reloads the two source sets only after authorizing the selected workspace and its project. */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const query = new URL(request.url).searchParams;
    const services = await getApplicationServices();
    if (query.get("refresh") === "1") {
      const workspace = query.get("workspaceId");
      const plan = query.get("planId");
      const workspaceId = workspace === null ? null : readPlanText(workspace);
      // The marker covers catalog and access only; runs and control have their own channel.
      const page = await services.agentPlanService.context(user.id, {
        planId: plan === null ? null : readPlanText(plan),
        workspaceId,
      });
      return planCatalogResponse(
        request,
        planCatalogRefresh(page, workspaceId).etag,
      );
    }
    const workspaceId = readPlanText(query.get("workspaceId"));
    const agentId = query.get("agentId");
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
    logCaughtError("agent_plan_sources", error);

    return agentFailureResponse(error);
  }
}
