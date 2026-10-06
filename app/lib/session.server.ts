import { createCookie } from "react-router";

import { resolveCookieSecure } from "@/app/lib/cookie-security.server";
import { SESSION_LIFETIME_SECONDS } from "@/backend/auth/SessionService";

const SESSION_COOKIE_NAME = "pages_session";

/**
 * Cookie configuration shared by Pages authentication route actions.
 *
 * @remarks
 * The `Secure` attribute depends on the request, so callers pass
 * `{ secure: resolveCookieSecure(request) }` to `serialize`.
 */
export const sessionCookie = createCookie(SESSION_COOKIE_NAME, {
  httpOnly: true,
  maxAge: SESSION_LIFETIME_SECONDS,
  path: "/",
  sameSite: "lax",
});

/** Reads a valid session token from an incoming request. */
export async function getSessionToken(
  request: Request,
): Promise<string | null> {
  try {
    const token: unknown = await sessionCookie.parse(
      request.headers.get("Cookie"),
    );

    return typeof token === "string" ? token : null;
  } catch {
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
