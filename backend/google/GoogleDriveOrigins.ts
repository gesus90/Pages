import { PUBLIC_URL_SETTING_NAME } from "@/backend/discord/DiscordConfig";
import { logCaughtError } from "@/backend/logging/Logger";

/** The settings that decide which origins may start a Google Drive sign-in. */
export interface GoogleDriveOriginSettings {
  /** The port Pages listens on; the loopback origin of the browser's machine uses it. */
  readonly port: number;
  /** The configured `publicUrl`; `PAGES_PUBLIC_URL` stands in while it is missing. */
  readonly publicUrl?: string | undefined;
}

function readRemoteOrigin(configured: string | undefined): string | null {
  const text = configured?.trim();

  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);

    return url.protocol === "https:" ? url.origin : null;
  } catch (caughtError: unknown) {
    logCaughtError("GoogleDriveOrigins", caughtError);

    return null;
  }
}

/**
 * Lists the origins a Google Drive sign-in may start from and return to.
 *
 * @param settings - Port and public address of the instance.
 * @param environment - Environment variables of the server process.
 * @returns The loopback origin `http://127.0.0.1:<port>` and, when configured,
 * the HTTPS origin of the public address; nothing else.
 *
 * @remarks
 * Only the configuration decides. The `Host` and `X-Forwarded-*` headers of a
 * request never add an origin, because a client chooses them. Plain HTTP is
 * allowed for the exact loopback address only; `localhost` is no stand-in,
 * because Google registers redirect URIs literally.
 */
export function listGoogleDriveOrigins(
  settings: GoogleDriveOriginSettings,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const origins = [new URL(`http://127.0.0.1:${settings.port}`).origin];
  const remote = readRemoteOrigin(
    settings.publicUrl ?? environment[PUBLIC_URL_SETTING_NAME],
  );

  if (remote !== null && !origins.includes(remote)) {
    origins.push(remote);
  }

  return origins;
}

/**
 * Accepts the origin of a request only when it is one of the allowed origins.
 *
 * @param requestOrigin - The origin of the request URL as the server built it.
 * @param allowedOrigins - The result of {@link listGoogleDriveOrigins}.
 * @returns The origin, or `null` for any other one.
 */
export function pickGoogleDriveOrigin(
  requestOrigin: string,
  allowedOrigins: readonly string[],
): string | null {
  return allowedOrigins.find((origin) => origin === requestOrigin) ?? null;
}
