import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  assessRequestOrigin,
  requestEntryContext,
} from "@/app/lib/request-origin.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "@/app/lib/settings-actions/settings-agents-response.server";
import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { openRouterBalanceDisplaySchema } from "@/definition/OpenRouterQuota";

import type { OpenRouterBalanceDisplay } from "@/definition/OpenRouterQuota";
import type { Route } from "./+types/agent-quota-card";

async function readCreditDisplay(
  request: Request,
): Promise<OpenRouterBalanceDisplay> {
  const mediaType = request.headers.get("Content-Type")?.split(";")[0]?.trim();
  if (request.method !== "POST" || mediaType !== "application/json")
    throw new AgentError("openrouter_balance_invalid");
  const body: unknown = await request.json().catch(() => null);
  const parsed = openRouterBalanceDisplaySchema.safeParse(body);
  if (!parsed.success) throw new AgentError("openrouter_balance_invalid");
  return parsed.data;
}

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

/** Changes the OpenRouter balance display of one usable connection. */
export async function action({
  context,
  params,
  request,
}: Route.ActionArgs): Promise<Response> {
  try {
    const user = context.get(authenticatedUserContext);
    if (!user || assessRequestOrigin(request, context.get(requestEntryContext)))
      throw new AgentAccessDeniedError();
    const display = await readCreditDisplay(request);
    const { quotaService } = await getApplicationServices();
    const { snapshot, isSaved } =
      await quotaService.setOpenRouterBalanceDisplay(
        user.id,
        params.connectionId,
        display,
      );
    return Response.json(snapshot, {
      status: isSaved ? 200 : 422,
      headers: AGENT_NO_STORE,
    });
  } catch (error: unknown) {
    logCaughtError("agent_openrouter_balance", error);
    return agentFailureResponse(error, "openrouter-balance");
  }
}
