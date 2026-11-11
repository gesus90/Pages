import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { resolveSystemSettingsAccess } from "@/app/lib/settings-actions/settings-system-access.server";
import {
  createServerSettingsService,
  handleSystemSettingsAction,
} from "@/app/lib/settings-actions/settings-system-actions.server";

import type { SettingsActionResult } from "@/app/lib/settings-actions/settings-action-support.server";
import type { SettingsSystemLoaderData } from "./settings-system";
import type { Route } from "./+types/settings-system-server";

/**
 * Loads the system settings for an administrator in the admin mode.
 *
 * @throws A `403` response for accounts without the admin permission.
 */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<SettingsSystemLoaderData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();

  if ((await resolveSystemSettingsAccess(services, user)) !== "granted") {
    return { access: "adminModeRequired" };
  }

  const serverSettings = await createServerSettingsService({ services });

  const [port, branding, wikiSettings, chatSettings, logging] =
    await Promise.all([
      serverSettings.readPort(),
      services.instanceSettingsService.getBranding(),
      services.wikiService.getSettings(),
      services.chatSettingsService.administration(user),
      serverSettings.readLogging(user),
    ]);

  return {
    access: "granted",
    audience: await readLocalStateAudience(services, user),
    branding,
    chatSettings,
    logging,
    port,
    wikiSettings,
  };
}

/**
 * Changes the system settings.
 *
 * @remarks
 * Every handler checks the permission itself, so a submission from an account
 * without the admin permission or outside the admin mode is refused there.
 */
export async function action(
  args: Route.ActionArgs,
): Promise<SettingsActionResult> {
  const settingsRequest = await readSettingsRequest(args);

  return handleSystemSettingsAction(
    settingsRequest.formData.get("intent"),
    settingsRequest,
  );
}
