import { useLoaderData } from "react-router";

import { AppShell } from "@/app/components/common/app-shell";
import { useAuthorizationRefresh } from "@/app/components/common/use-authorization-refresh";
import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { PERMISSION } from "@/definition/Role";

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
  const canViewProjects = await services.permissionService.allows(
    user,
    PERMISSION.PARTICIPATE_IN_PROJECTS,
  );

  return {
    canViewProjects,
    canViewUsers: navigation.canViewUsers,
    user,
    authorizationVersion: navigation.version,
    account: navigation.account,
  };
}

/** Renders the shared workspace navigation around authenticated child routes. */
export default function AuthenticatedRoute(): React.ReactElement {
  const { user, canViewProjects, canViewUsers, authorizationVersion, account } =
    useLoaderData<typeof loader>();
  const isOffline = useAuthorizationRefresh(authorizationVersion);

  return (
    <AppShell
      canViewProjects={canViewProjects}
      canViewUsers={canViewUsers}
      user={user}
      account={account}
      isOffline={isOffline}
    />
  );
}
