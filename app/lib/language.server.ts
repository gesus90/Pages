import { createCookie } from "react-router";

import { isLanguage, resolveLanguage } from "@/language/Language";

import type { Language } from "@/language/Language";

const LANGUAGE_COOKIE_NAME = "pages_language";
const LANGUAGE_COOKIE_LIFETIME_SECONDS = 60 * 60 * 24 * 365;

/** Cookie that remembers the language an anonymous visitor selected. */
export const languageCookie = createCookie(LANGUAGE_COOKIE_NAME, {
  httpOnly: true,
  maxAge: LANGUAGE_COOKIE_LIFETIME_SECONDS,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
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
  const cookieValue: unknown = await languageCookie
    .parse(request.headers.get("Cookie"))
    .catch(() => null);

  if (isLanguage(cookieValue)) {
    return cookieValue;
  }

  return resolveLanguage(request.headers.get("Accept-Language") ?? undefined);
}
