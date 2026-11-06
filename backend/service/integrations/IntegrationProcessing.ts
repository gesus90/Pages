import { IntegrationOwnerRepository } from "@/backend/database/repositories/integrations/IntegrationOwnerRepository";
import { logEvent } from "@/backend/logging/Logger";

import type { PagesConfig } from "@/backend/config/PagesConfig";

let owner: IntegrationOwnerRepository | null = null;
let isOwner = false;

/** Whether this process currently owns GitHub and FCM delivery. Producers never depend on this. */
export function canProcessIntegrations(): boolean {
  return isOwner;
}

/** Selects the persisted mode (legacy server by default), then takes database ownership. */
export async function claimIntegrationProcessing(
  config: PagesConfig,
  role: "server" | "separate",
): Promise<boolean> {
  if ((config.integrationsMode ?? "server") !== role) return false;
  if (isOwner) return true;
  if (config.firstRun || !config.databaseUrl)
    throw new Error(
      "Integration processing requires completed PostgreSQL setup.",
    );
  owner = new IntegrationOwnerRepository(config.databaseUrl, () => {
    isOwner = false;
    logEvent({
      level: "fatal",
      event: "integrations.ownership.lost",
      component: "IntegrationProcessing",
      message:
        "Integration ownership lost; terminating before further delivery",
    });
    // An unconfirmed old consumer must not overlap a newly elected consumer.
    process.exit(1);
  });
  isOwner = await owner.acquire();
  if (!isOwner) owner = null;
  return isOwner;
}

/** Disables callbacks before drain. The session lock stays held until process exit. */
export function stopIntegrationProcessing(): void {
  isOwner = false;
}
