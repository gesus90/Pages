import { browserSessionCookie } from "@/backend/auth/BrowserSessionCookie";

import { resolveCookieSecure } from "@/app/lib/cookie-security.server";
import { logCaughtError } from "@/backend/logging/Logger";

/** Shared browser cookie; callers select Secure from the trusted request origin. */
export const sessionCookie = browserSessionCookie;

/** Reads a valid session token from an incoming request. */
export async function getSessionToken(
  request: Request,
): Promise<string | null> {
  return readSessionToken(request.headers.get("Cookie"));
}

/**
 * Reads the session token from a `Cookie` header, such as one `pages-core` passes on.
 *
 * @param cookieHeader - The header as the browser sent it.
 * @returns The token, or `null` when the header holds none.
 */
export async function readSessionToken(
  cookieHeader: string | null,
): Promise<string | null> {
  try {
    const token: unknown = await sessionCookie.parse(cookieHeader);

    return typeof token === "string" ? token : null;
  } catch (caughtError: unknown) {
    logCaughtError("session", caughtError);

    return null;
  }
}

/**
 * Creates the response header value that removes the browser session token.
 *
 * @param request - Request the response answers.
 */
export async function destroySessionCookie(request: Request): Promise<string> {
  return sessionCookie.serialize("", {
    maxAge: 0,
    secure: resolveCookieSecure(request),
  });
}
