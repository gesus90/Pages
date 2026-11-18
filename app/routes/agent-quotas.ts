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
 * Answers the quota page with the cards of the person: a card per Claude or
 * Antigravity connection the person may use, with the figures the provider
 * last reported.
 * @remarks
 * The answer comes from the stored figures and never waits for a provider: the
 * page shows these cards at once and then asks for the current usage of each
 * card on its own route. The rights are read anew with every answer.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const services = await getApplicationServices();
    const snapshot = await services.quotaService.listStoredForUser(user.id);
    return Response.json(snapshot, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_quotas", error);
    return agentFailureResponse(error, "quotas");
  }
}
