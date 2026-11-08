import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import {
  listGoogleDriveOrigins,
  pickGoogleDriveOrigin,
} from "@/backend/google/GoogleDriveOrigins";

/** Headers of every Google Drive answer: never stored, never named to a third party. */
export const GOOGLE_DRIVE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};

/** The origins Google Drive may be connected from, and the one of this request. */
export interface GoogleDriveRequestOrigins {
  /** Every allowed origin: the loopback one and the configured HTTPS one. */
  readonly allowed: readonly string[];
  /** The origin this request came in on, or `null` when it is not an allowed one. */
  readonly current: string | null;
}

/**
 * Resolves the origin the Google redirect URI of this request is built on.
 *
 * @param request - The request of the administrator.
 * @returns The allowed origins and the request's own when it is one of them.
 *
 * @remarks
 * Google accepts only a redirect URI registered exactly at the OAuth client.
 * Both the local and the remote address work with one instance, so the request
 * decides between them, but only among the origins the configuration names
 * (`http://127.0.0.1:<port>` and the HTTPS `publicUrl`); a sign-in started on
 * one origin therefore never returns to the other and keeps its Pages session.
 */
export async function resolveGoogleDriveOrigins(
  request: Request,
): Promise<GoogleDriveRequestOrigins> {
  const allowed = listGoogleDriveOrigins((await getPagesRuntime()).getConfig());

  return {
    allowed,
    current: pickGoogleDriveOrigin(new URL(request.url).origin, allowed),
  };
}
