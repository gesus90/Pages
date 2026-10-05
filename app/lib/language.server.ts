import { createCookie } from "react-router";

import { resolveCookieSecure } from "@/app/lib/cookie-security.server";
import { isLanguage, LANGUAGE, resolveLanguage } from "@/language/Language";

import type { Language } from "@/language/Language";

const LANGUAGE_COOKIE_NAME = "pages_language";
const LANGUAGE_COOKIE_LIFETIME_SECONDS = 60 * 60 * 24 * 365;

/** Cookie that remembers the language an anonymous visitor selected. */
export const languageCookie = createCookie(LANGUAGE_COOKIE_NAME, {
  httpOnly: true,
  maxAge: LANGUAGE_COOKIE_LIFETIME_SECONDS,
  path: "/",
  sameSite: "lax",
  secure: resolveCookieSecure(),
});

/**
 * Resolves the language to use for a visitor who is not signed in.
 *
 * @param request - Incoming request.
 * @returns The language the visitor previously selected, or one derived
 * from their browser's `Accept-Language` header.
 */
export async function resolveAnonymousLanguage(
  request: Request,
): Promise<Language> {
  return (
    (await readSelectedLanguage(request)) ??
    resolveLanguage(request.headers.get("Accept-Language") ?? undefined)
  );
}

/**
 * Resolves the language of the setup wizard.
 *
 * @param request - Incoming request.
 * @returns The language the visitor selected, otherwise German.
 */
export async function resolveSetupLanguage(
  request: Request,
): Promise<Language> {
  return (await readSelectedLanguage(request)) ?? LANGUAGE.GERMAN;
}

async function readSelectedLanguage(
  request: Request,
): Promise<Language | null> {
  const cookieValue: unknown = await languageCookie
    .parse(request.headers.get("Cookie"))
    .catch(() => null);

  return isLanguage(cookieValue) ? cookieValue : null;
}
