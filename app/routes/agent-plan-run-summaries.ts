import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-plan-run-summaries";

/**
 * Lists the executor's runs of a readable plan, newest first, without snapshots or results.
 *
 * @remarks
 * Each entry names only the start and the status. A run is listed only while
 * the person may read its content, as `/agent-api/plan-runs` checks it.
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const planId = readPlanText(
      new URL(request.url).searchParams.get("planId"),
    );
    const services = await getApplicationServices();
    const runs = await services.agentPlanRunHistoryService.visibleRuns(
      user.id,
      planId,
    );
    return Response.json(
      { ok: true, intent: "run-summaries", planId, runs },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("agent_plan_run_summaries", error);

    return agentFailureResponse(error, "run-summaries");
  }
}
