import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-plan-swarm-memory";

/** The shared memory of one swarm node of a run, for whoever may read the run. */
export async function loader({
  params,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const services = await getApplicationServices();
    const memory = await services.agentPlanSwarmMemoryService.view(
      user.id,
      readPlanText(params.runId),
      readPlanText(params.stepId),
    );
    return Response.json(
      { memory },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error: unknown) {
    logCaughtError("agent_plan_swarm_memory", error);
    return agentFailureResponse(error, "swarm-memory");
  }
}
