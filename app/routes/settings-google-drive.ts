import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  GOOGLE_DRIVE_NO_STORE_HEADERS,
  resolveGoogleDriveOrigins,
} from "@/app/lib/google-drive-route.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { isSystemSettingsGranted } from "@/app/lib/settings-actions/settings-system-access.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { GoogleDriveActionResult } from "@/definition/GoogleDrive";
import type { User } from "@/definition/User";
import type { Route } from "./+types/settings-google-drive";

function respond(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: GOOGLE_DRIVE_NO_STORE_HEADERS,
    status,
  });
}

/** Returns the services when the account works as administrator in the admin mode, else `null`. */
async function grantedServices(
  user: User | null,
): Promise<ApplicationServices | null> {
  if (!user) {
    return null;
  }

  const services = await getApplicationServices();

  return (await isSystemSettingsGranted(services, user)) ? services : null;
}

/**
 * Tells an administrator in the admin mode where the Google Drive connection stands.
 *
 * @remarks
 * A stored connection is confirmed by a real read-only Drive request on every
 * call, so the card never shows a connection Google no longer accepts.
 */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const services = await grantedServices(context.get(authenticatedUserContext));

  if (!services) {
    return respond({ error: "forbidden", ok: false }, 403);
  }

  return respond(
    await services.googleDriveConnectionService.getStatus(
      await resolveGoogleDriveOrigins(request),
    ),
  );
}

/**
 * Starts the Google sign-in for an administrator in the admin mode.
 *
 * @remarks
 * The answer carries the official Google link; the browser opens it itself,
 * so no password of Google ever passes through Pages. `access=write` asks for
 * the targeted write consent of Storage (PAGE-270) instead of the first sign-in. Only an allowed origin
 * starts a sign-in, and the link returns to exactly that origin.
 */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const user = context.get(authenticatedUserContext);
  const services = await grantedServices(user);

  if (!user || !services) {
    return respond(
      { error: "forbidden", ok: false } satisfies GoogleDriveActionResult,
      403,
    );
  }

  const { current } = await resolveGoogleDriveOrigins(request);

  if (current === null) {
    return respond(
      {
        error: "origin_not_allowed",
        ok: false,
      } satisfies GoogleDriveActionResult,
      403,
    );
  }

  try {
    const formData = await request.formData();
    const authorizeUrl = await services.googleDriveConnectionService.start({
      access: formData.get("access") === "write" ? "write" : "read",
      baseUrl: current,
      userId: user.id,
    });

    return authorizeUrl === null
      ? respond(
          {
            error: "not_configured",
            ok: false,
          } satisfies GoogleDriveActionResult,
          409,
        )
      : respond({ authorizeUrl, ok: true } satisfies GoogleDriveActionResult);
  } catch (error: unknown) {
    logCaughtError("settings_google_drive", error);

    return respond(
      { error: "failed", ok: false } satisfies GoogleDriveActionResult,
      500,
    );
  }
}
