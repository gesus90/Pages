import { useLoaderData } from "react-router";

import { AppShell } from "@/app/components/common/app-shell";
import {
  authenticatedUserContext,
  requireAuthenticatedUser,
} from "@/app/lib/auth.server";

import type { LoaderFunctionArgs, MiddlewareFunction } from "react-router";
import type { User } from "@/definition/User";

/** Applies persistent-session authentication to all nested workspace routes. */
export const middleware: MiddlewareFunction[] = [requireAuthenticatedUser];

/** Returns the authenticated user for the shared workspace layout. */
export function loader({ context }: LoaderFunctionArgs): { user: User } {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  return { user };
}

/** Renders the shared workspace navigation around authenticated child routes. */
export default function AuthenticatedRoute(): React.ReactElement {
  const { user } = useLoaderData<typeof loader>();

  return <AppShell user={user} />;
}
