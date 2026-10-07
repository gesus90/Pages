import { useLoaderData } from "react-router";

import { AppShell } from "@/app/components/common/app-shell";
import { RegionProvider } from "@/app/components/common/region-provider";
import { useAuthorizationRefresh } from "@/app/components/common/use-authorization-refresh";
import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { PERMISSION } from "@/definition/Role";

import type { InstanceBranding } from "@/definition/Instance";
import type { RegionPreferences } from "@/app/components/common/region-provider";
import type { MiddlewareFunction } from "react-router";
import type { User } from "@/definition/User";
import type { AccountAccess } from "@/definition/Authorization";
import type { Route } from "./+types/authenticated";

/** Applies persistent-session authentication to all nested workspace routes. */
export const middleware: MiddlewareFunction[] = [requireAuthenticatedUser];

interface AuthenticatedLoaderData {
  readonly account: AccountAccess;
  readonly authorizationVersion: string;
  readonly user: User;
  readonly canViewProjects: boolean;
  readonly canViewUsers: boolean;
  /** How the user wants dates and times shown. */
  readonly region: RegionPreferences;
  /** Company name and logo of the instance. */
  readonly branding: InstanceBranding;
}

/** Returns the authenticated user and their navigation permissions. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<AuthenticatedLoaderData> {
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

  return {
    branding,
    canViewProjects,
    canViewUsers: navigation.canViewUsers,
    region: { dateFormat, timezone },
    user,
    authorizationVersion: navigation.version,
    account: navigation.account,
  };
}

/** Renders the shared workspace navigation around authenticated child routes. */
export default function AuthenticatedRoute(): React.ReactElement {
  const {
    user,
    canViewProjects,
    canViewUsers,
    authorizationVersion,
    account,
    region,
    branding,
  } = useLoaderData<typeof loader>();
  const isOffline = useAuthorizationRefresh(authorizationVersion);

  return (
    <RegionProvider region={region}>
      <AppShell
        branding={branding}
        canViewProjects={canViewProjects}
        canViewUsers={canViewUsers}
        user={user}
        account={account}
        isOffline={isOffline}
      />
    </RegionProvider>
  );
}
