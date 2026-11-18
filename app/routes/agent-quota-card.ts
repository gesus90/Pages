import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/agent-quota-card";

/**
 * Answers one query of a single quota card: the provider of the connection is
 * asked for its current usage and the card is answered from the stored figures.
 * @remarks
 * The page asks once per card, so a slow connection delays only its own
 * card. The answer holds the card, or no account when the person may not use
 * the connection (any more); the rights are read before the provider is asked and
 * again before the answer leaves.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user) throw new AgentError("plan_access_denied");
    const services = await getApplicationServices();
    const snapshot = await services.quotaService.refreshForUser(
      user.id,
      params.connectionId,
    );
    return Response.json(snapshot, { headers: AGENT_NO_STORE });
  } catch (error: unknown) {
    logCaughtError("agent_quota_card", error);
    return agentFailureResponse(error, "quota-card");
  }
}
