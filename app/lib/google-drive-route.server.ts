import { resolvePublicBaseUrl } from "@/backend/discord/DiscordConfig";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

/** Headers of every Google Drive answer: never stored, never named to a third party. */
export const GOOGLE_DRIVE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};

/**
 * Resolves the public address the Google redirect URI is built on.
 *
 * @param request - The request of the administrator.
 * @returns The configured `publicUrl`, else `PAGES_PUBLIC_URL`, else the
 * request origin; never a trailing slash.
 *
 * @remarks
 * Google accepts only a redirect URI registered exactly at the OAuth client,
 * so a configured public address keeps it stable behind a proxy.
 */
export async function resolveGoogleDriveBaseUrl(
  request: Request,
): Promise<string> {
  const configured = (await getPagesRuntime()).getConfig().publicUrl;

  return configured
    ? new URL(configured).origin
    : resolvePublicBaseUrl(new URL(request.url).origin);
}
