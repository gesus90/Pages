import { createCookie } from "react-router";

import { SESSION_LIFETIME_SECONDS } from "@/backend/auth/SessionService";

const SESSION_COOKIE_NAME = "pages_session";

/** Cookie configuration shared by Pages authentication route actions. */
export const sessionCookie = createCookie(SESSION_COOKIE_NAME, {
  httpOnly: true,
  maxAge: SESSION_LIFETIME_SECONDS,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
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

/** Creates the response header value that removes the browser session token. */
export async function destroySessionCookie(): Promise<string> {
  return sessionCookie.serialize("", { maxAge: 0 });
}
