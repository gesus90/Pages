import { createCookie } from "react-router";

import { SESSION_LIFETIME_SECONDS } from "./SessionService";

/** Shared cookie codec for human logins and issued agent browser sessions. */
export const browserSessionCookie = createCookie("pages_session", {
  httpOnly: true,
  maxAge: SESSION_LIFETIME_SECONDS,
  path: "/",
  sameSite: "lax",
});
