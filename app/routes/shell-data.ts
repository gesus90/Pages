import { authenticatedUserContext } from "@/app/lib/auth.server";
import { routeDataResponse } from "@/app/lib/local-state/route-data.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { PERMISSION } from "@/definition/Role";

import type { ShellData } from "@/app/lib/shell-data";
import type { Route } from "./+types/shell-data";

/** Returns the authenticated user and their navigation permissions. */
async function readShell(
  context: Route.LoaderArgs["context"],
): Promise<ShellData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const navigation = await services.administrationService.navigation(user.id);
  const { dateFormat, timezone } =
    await services.settingsService.getUserSettings(user.id);
  const branding = await services.instanceSettingsService.getBranding();
  const canViewProjects = await services.permissionService.allows(
    user,
    PERMISSION.PARTICIPATE_IN_PROJECTS,
  );
  const pica = await services.picaSettingsService.read();

  return {
    isPicaEnabled: pica.isEnabled,
    branding,
    canViewProjects,
    canViewUsers: navigation.canViewUsers,
    region: { dateFormat, timezone },
    user,
    authorizationVersion: `${navigation.version}:pica:${pica.revision}`,
    account: navigation.account,
  };
}

/**
 * Answers the workspace frame of the static app: the account, its navigation
 * rights, its region settings, the instance branding and whether Pica is on.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  return routeDataResponse(await readShell(context));
}
