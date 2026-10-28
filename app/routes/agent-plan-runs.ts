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
import { planPollingResponse } from "@/app/lib/agent-plan-poll-response.server";
import { displayPlanRun } from "@/app/lib/agent-plan-display.server";

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
    const query = new URL(request.url).searchParams;
    const services = await getApplicationServices();
    if (query.has("planId")) {
      const planId = readPlanText(query.get("planId"));
      if (query.get("startRejections") === "true")
        return Response.json(
          {
            ok: true,
            planId,
            history: await services.agentPlanService.startRejections(
              user.id,
              planId,
              query.has("before") ? readPlanText(query.get("before")) : null,
            ),
          },
          { headers: AGENT_NO_STORE },
        );
      const control = await services.agentPlanService.control(user.id, planId);
      const observation = request.headers.get("X-Plan-Observation");
      if (observation === "open" || observation === "renew")
        services.runnerService.observePlan(planId, observation === "open");
      return planPollingResponse(request, {
        ok: true,
        intent: "poll-control",
        control,
      });
    }
    runId = readPlanText(query.get("runId"));
    return planPollingResponse(request, {
      ok: true,
      intent: "poll-run",
      run: displayPlanRun(await services.agentPlanService.run(user.id, runId)),
    });
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
