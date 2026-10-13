import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  AGENT_NO_STORE,
  agentFailureResponse,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";

import type { Route } from "./+types/agent-run-record";

/** Private markdown requires current agent, executor, plan and source-resource authorization. */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("agent_usage_denied");
    const services = await getApplicationServices();
    await services.pageAgentService.require(user.id, params.agentId);
    const archived = await services.agentRunArchive.read(
      user.id,
      params.agentId,
      params.runId,
    );
    await services.agentPlanService.run(user.id, archived.record.planRunId);
    return new Response(archived.markdown, {
      headers: {
        ...AGENT_NO_STORE,
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  } catch (error: unknown) {
    return agentFailureResponse(error);
  }
}
