import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-quotas";

/**
 * Answers one query of the quota page: a card per Claude connection the
 * person may use, with the windows Claude reported.
 * @remarks
 * The page asks when it opens and when the refresh button is pressed; the
 * minute beat comes from the event stream of the page. Each query asks
 * Claude for the current usage of these connections.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const services = await getApplicationServices();
    const snapshot = await services.claudeQuotaService.listForUser(user.id);
    return Response.json(snapshot, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_quotas", error);
    return agentFailureResponse(error, "quotas");
  }
}
