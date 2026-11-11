import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { runDetail } from "@/backend/service/agents/AgentPlanOperationViews";

import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { Route } from "./+types/agent-run-diagnosis";

/** The query of the run view as the parameters of the diagnosis reads. */
function readParameters(query: URLSearchParams): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (const [name, value] of query) {
    if (name === "view" || value === "") continue;
    parameters[name] =
      name === "limit" && /^\d{1,6}$/u.test(value) ? Number(value) : value;
  }
  return parameters;
}

async function readView(
  plans: AgentPlanService,
  userId: string,
  query: URLSearchParams,
): Promise<unknown> {
  const { diagnosis } = plans;
  if (!diagnosis) throw new AgentError("plan_access_denied");
  const parameters = readParameters(query);
  switch (query.get("view") ?? "") {
    case "plans":
      return { plans: await diagnosis.visiblePlans(userId), userId };
    case "runs":
      return diagnosis.listRuns(userId, parameters);
    case "failures":
      return diagnosis.summarizeFailures(userId, parameters);
    case "timeline":
      return diagnosis.timeline(userId, parameters);
    case "logs":
      return diagnosis.logs(userId, parameters);
    case "run": {
      const readable = await plans.readableRun(
        userId,
        String(parameters.runId ?? ""),
      );
      return {
        run: runDetail(readable.run, readable.startedBy),
        startedBy: readable.startedBy,
        hiddenFields: readable.hiddenFields,
        isStarter: readable.run.userId === userId,
      };
    }
    default:
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "parameter_invalid",
      });
  }
}

/**
 * Answers the run view (PAGE-307): runs of all visible plans, the failure
 * overview, one run with its timeline and logs.
 *
 * @remarks
 * The same service and rights as the Pages tools; reading never controls a run.
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const services = await getApplicationServices();
    const result = await readView(
      services.agentPlanService,
      user.id,
      new URL(request.url).searchParams,
    );
    return Response.json(result, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_run_diagnosis", error);

    if (error instanceof AgentOperationError)
      return Response.json(
        { ok: false, error: error.code, reason: error.details },
        { status: error.status, headers: AGENT_NO_STORE },
      );
    return agentFailureResponse(error, "run-diagnosis");
  }
}
