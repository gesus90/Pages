import { planCatalogResponse } from "@/app/lib/agent-plan-catalog.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { picaCatalogRefresh } from "@/app/lib/pica-catalog.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { requireAgentAccount } from "@/app/lib/settings-actions/settings-agents-access.server";
import { agentFailureResponse } from "@/app/lib/settings-actions/settings-agents-response.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/settings-pica-models";

/**
 * Answers whether Pica's model projection changed since the card loaded it.
 *
 * @remarks
 * Only administrators in the active admin mode may ask. The answer is 304
 * for an unchanged projection and a bare change marker otherwise; the card
 * then reloads its data through the page's own loader. Reading the projection
 * uses only saved catalogs: no provider is called and no model runs.
 */
export async function loader({
  request,
  context,
}: Route.LoaderArgs): Promise<Response> {
  try {
    const services = await getApplicationServices();
    const actor = await requireAgentAccount(
      services,
      context.get(authenticatedUserContext),
    );
    const pica = await services.picaSettingsService.administration(
      actor.userId,
    );
    return planCatalogResponse(request, picaCatalogRefresh(pica).etag);
  } catch (error: unknown) {
    logCaughtError("settings_pica_models", error);

    return agentFailureResponse(error);
  }
}
