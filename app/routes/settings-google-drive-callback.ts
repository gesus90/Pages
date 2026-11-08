import { redirect } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  GOOGLE_DRIVE_NO_STORE_HEADERS,
  resolveGoogleDriveOrigins,
} from "@/app/lib/google-drive-route.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { isSystemSettingsGranted } from "@/app/lib/settings-actions/settings-system-access.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { GoogleDriveCallbackOutcome } from "@/definition/GoogleDrive";
import type { Route } from "./+types/settings-google-drive-callback";

async function completeSignIn(
  request: Request,
  userId: string,
): Promise<GoogleDriveCallbackOutcome> {
  const parameters = new URL(request.url).searchParams;
  const services = await getApplicationServices();

  try {
    return await services.googleDriveConnectionService.complete(userId, {
      baseUrl: (await resolveGoogleDriveOrigins(request)).current,
      code: parameters.get("code"),
      error: parameters.get("error"),
      state: parameters.get("state"),
    });
  } catch (error: unknown) {
    logCaughtError("settings_google_drive_callback", error);

    return "failed";
  }
}

/**
 * Receives the browser after the Google sign-in.
 *
 * @remarks
 * Unlike the Discord callback it needs a Pages session of the administrator
 * who started the sign-in, in the admin mode: the `state` alone does not bind
 * a Google account to the instance. The answer only redirects to the system
 * settings of the origin it came in on, without code and state in the address;
 * a callback on another origin than the sign-in started on is refused.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  let outcome: GoogleDriveCallbackOutcome = "forbidden";

  if (
    user &&
    (await isSystemSettingsGranted(await getApplicationServices(), user))
  ) {
    outcome = await completeSignIn(request, user.id);
  }

  return redirect(`/settings/system?googleDrive=${outcome}`, {
    headers: GOOGLE_DRIVE_NO_STORE_HEADERS,
  });
}
