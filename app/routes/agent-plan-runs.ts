import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-plan-runs";

/** Polling reveals only the executing user's sanitized results and current status. */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  let runId = "";
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    runId = readPlanText(new URL(request.url).searchParams.get("runId"));
    const services = await getApplicationServices();
    return Response.json(
      {
        ok: true,
        intent: "poll-run",
        run: await services.agentPlanService.run(user.id, runId),
      },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("agent_plan_runs", error);

    const failure = agentFailureResponse(error, "poll-run");
    const detail: unknown = await failure.json();
    return Response.json(
      { ...readAgentObject(detail), runId },
      { status: failure.status, headers: AGENT_NO_STORE },
    );
  }
}
