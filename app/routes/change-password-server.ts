import { redirect } from "react-router";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { loginDestination } from "@/app/lib/login-destination.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { handleChangePassword } from "@/app/lib/settings-actions/settings-account-actions.server";

import type { User } from "@/definition/User";
import type { Route } from "./+types/change-password-server";

async function requirePasswordChange(request: Request): Promise<User> {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    throw redirect(`/login?returnTo=${encodeURIComponent(loginDestination())}`);
  }

  if (!user.mustChangePassword) {
    throw redirect(loginDestination());
  }

  return user;
}

/**
 * Allows only authenticated accounts whose password must be replaced.
 *
 * @remarks
 * The endpoint `/app-api/change-password` runs it (PAGE-235).
 */
export async function loader({ request }: Route.LoaderArgs): Promise<null> {
  await requirePasswordChange(request);
  return null;
}

/** Replaces the temporary password before any workspace request is allowed. */
export async function action({
  request,
}: Route.ActionArgs): Promise<
  Response | Awaited<ReturnType<typeof handleChangePassword>>
> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const user = await requirePasswordChange(request);
  const result = await handleChangePassword({
    formData: await request.formData(),
    request,
    services: await getApplicationServices(),
    user,
  });

  return result.data.outcome === "success"
    ? redirect(loginDestination())
    : result;
}
