import { useLoaderData } from "react-router";

import { AppShell } from "@/app/components/common/app-shell";
import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { PERMISSION } from "@/definition/Role";

import type { LoaderFunctionArgs, MiddlewareFunction } from "react-router";
import type { User } from "@/definition/User";

/** Applies persistent-session authentication to all nested workspace routes. */
export const middleware: MiddlewareFunction[] = [requireAuthenticatedUser];

interface AuthenticatedLoaderData {
  readonly user: User;
  readonly canViewProjects: boolean;
  readonly canViewUsers: boolean;
}

/** Returns the authenticated user and their navigation permissions. */
export async function loader({
  context,
}: LoaderFunctionArgs): Promise<AuthenticatedLoaderData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const canViewUsers = services.permissionService.hasPermission(
    user.role,
    PERMISSION.VIEW_USERS,
  );
  const canViewProjects = services.permissionService.hasPermission(
    user.role,
    PERMISSION.PARTICIPATE_IN_PROJECTS,
  );

  return { canViewProjects, canViewUsers, user };
}

/** Renders the shared workspace navigation around authenticated child routes. */
export default function AuthenticatedRoute(): React.ReactElement {
  const { user, canViewProjects, canViewUsers } =
    useLoaderData<typeof loader>();

  return (
    <AppShell
      canViewProjects={canViewProjects}
      canViewUsers={canViewUsers}
      user={user}
    />
  );
}
