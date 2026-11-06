import { data, redirect } from "react-router";

import { getAuthenticatedUser, parseCredentials } from "@/app/lib/auth.server";
import { getClientAddress } from "@/app/lib/client-address.server";
import { resolveCookieSecure } from "@/app/lib/cookie-security.server";
import { resolveAnonymousLanguage } from "@/app/lib/language.server";
import { sessionCookie } from "@/app/lib/session.server";
import { loginDestination } from "@/app/lib/login-destination.server";
import { databaseFailureHeaders } from "@/app/lib/database-failure.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { TooManyLoginAttemptsError } from "@/backend/auth/LoginThrottle";
import { DatabaseExecutorError } from "@/backend/database/executor/DatabaseExecutorErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { LoginResult } from "@/backend/auth/AuthService";
import type { LoginActionData, LoginLoaderData } from "./login";
import type { Route } from "./+types/login-server";

type LoginActionResult = Response | ReturnType<typeof data<LoginActionData>>;

/**
 * Redirects a visitor who already has an active Pages session.
 *
 * @remarks
 * The endpoint `/app-api/login` answers with it (PAGE-235).
 * Everyone else gets their previously selected or browser-derived language
 * so the page, including its language switcher, renders correctly.
 */
export async function loader({
  request,
}: Route.LoaderArgs): Promise<Response | LoginLoaderData> {
  const user = await getAuthenticatedUser(request);

  if (user) {
    return redirect(loginDestination(request));
  }

  const services = await getApplicationServices();
  const destination = loginDestination(request);

  return {
    branding: await services.instanceSettingsService.getBranding(),
    language: await resolveAnonymousLanguage(request),
    loginPath:
      destination === "/dashboard"
        ? "/login"
        : `/login?returnTo=${encodeURIComponent(destination)}`,
  };
}

/** Validates credentials and creates a persistent browser session. */
export async function action({
  request,
}: Route.ActionArgs): Promise<LoginActionResult> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const credentials = parseCredentials(await request.formData());

  if (!credentials) {
    return data<LoginActionData>(
      { error: "invalidCredentials" },
      { status: 400 },
    );
  }

  let loginResult: LoginResult | null;

  try {
    const services = await getApplicationServices();
    loginResult = await services.authService.login(
      credentials.username,
      credentials.password,
      request.headers.get("user-agent"),
      getClientAddress(request),
    );
  } catch (error: unknown) {
    logCaughtError("login", error);

    if (error instanceof TooManyLoginAttemptsError) {
      return data<LoginActionData>(
        { error: "tooManyAttempts" },
        {
          headers: { "Retry-After": String(error.retryAfterSeconds) },
          status: 429,
        },
      );
    }

    // The database is busy or restarting (PAGE-197); the form asks to retry.
    if (error instanceof DatabaseExecutorError) {
      return data<LoginActionData>(
        { error: "unavailable" },
        { headers: databaseFailureHeaders(error), status: 503 },
      );
    }

    throw error;
  }

  if (!loginResult) {
    return data<LoginActionData>(
      { error: "invalidCredentials" },
      { status: 401 },
    );
  }

  return redirect(loginDestination(request), {
    headers: {
      "Set-Cookie": await sessionCookie.serialize(loginResult.sessionToken, {
        secure: resolveCookieSecure(request),
      }),
    },
  });
}
