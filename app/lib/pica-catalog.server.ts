import { planPollingEtag } from "./agent-plan-poll-response.server";

import type { ModelCatalogRefresh } from "@/app/components/agents/model-picker/use-model-catalog-refresh";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { PicaAdministration } from "@/definition/PicaSettings";

/** Where the Pica card asks whether its model projection changed. */
export const PICA_CATALOG_URL = "/settings-api/pica-models";

/**
 * The marker of Pica's model projection: the shared catalog's models Pica can
 * run for the administrator, and the saved choice with its current state.
 *
 * @param pica - What the protected Pica form loaded.
 * @returns The marker URL and an ETag that changes with any model, source,
 * price, reasoning level, access or saved choice; it carries no secret.
 */
export function picaCatalogRefresh(pica: {
  readonly settings: PicaAdministration;
  readonly models: readonly PageAgentModel[];
}): ModelCatalogRefresh {
  return { url: PICA_CATALOG_URL, etag: planPollingEtag(pica) };
}
