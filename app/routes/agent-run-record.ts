import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  AGENT_NO_STORE,
  agentFailureResponse,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-run-record";

/**
 * Delivers the markdown of one agent run to the person who started it.
 *
 * @remarks
 * The agent must still be visible to the requester, the run must be theirs,
 * and the plan and its source resources must still be accessible to them.
 * A record of someone else and a missing record are refused alike.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("agent_usage_denied");
    const services = await getApplicationServices();
    await services.pageAgentService.requireVisible(user.id, params.agentId);
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
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    logCaughtError("agent_run_record", error);

    return agentFailureResponse(error);
  }
}
