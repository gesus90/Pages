import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { handleSettingsAction } from "@/app/lib/settings-actions/settings-actions.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { getSessionToken } from "@/app/lib/session.server";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";

import type { SettingsActionResult } from "@/app/lib/settings-actions/settings-action-support.server";
import type { SettingsLoaderData } from "./settings-profile";
import type { Route } from "./+types/settings-profile-server";

/** Loads the personal settings and profile context of the authenticated visitor. */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<SettingsLoaderData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const [settings, email, sessions] = await Promise.all([
    services.settingsService.getUserSettings(user.id),
    services.userService.findProfileEmail(user.id),
    services.sessionService.getSessionSummaries(
      user.id,
      await getSessionToken(request),
    ),
  ]);
  const account = await services.administrationService.getContext(user.id);
  const canEditProfile = new UserPolicyService().isAdministrator(account);
  const designThemes = await services.designThemeService.getSelection(user.id, {
    includeSkipped: account.isAdmin,
  });

  return {
    account,
    audience: await readLocalStateAudience(services, user),
    canEditProfile,
    designThemes,
    email,
    sessions,
    settings,
    user,
  };
}

/** Persists settings and manages sessions, profile edits, and passwords. */
export async function action(
  args: Route.ActionArgs,
): Promise<SettingsActionResult> {
  const settingsRequest = await readSettingsRequest(args);

  return handleSettingsAction(
    settingsRequest.formData.get("intent"),
    settingsRequest,
  );
}
