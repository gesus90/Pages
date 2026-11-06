import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { listsAdminSettings } from "@/app/lib/settings-actions/settings-system-access.server";

import type { SettingsLayoutData } from "./settings";
import type { Route } from "./+types/settings-server";

/** Decides which settings areas the navigation lists for the visitor. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<SettingsLayoutData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const [account, audience] = await Promise.all([
    services.administrationService.getContext(user.id),
    readLocalStateAudience(services, user),
  ]);

  return { canViewSystem: listsAdminSettings(account), audience };
}
