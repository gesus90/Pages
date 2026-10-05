/**
 * Decides whether cookies carry the `Secure` attribute.
 *
 * @param environment - Process environment to read from.
 * @returns Whether browsers may only send the cookies over HTTPS.
 *
 * @remarks
 * `PAGES_COOKIE_SECURE=true|false` overrides the default, which is secure in
 * production. Self-hosted installations served over plain HTTP outside of
 * localhost need `false`, because browsers drop `Secure` cookies there.
 */
export function resolveCookieSecure(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = environment.PAGES_COOKIE_SECURE?.trim().toLowerCase();

  if (configured === "true") {
    return true;
  }

  if (configured === "false") {
    return false;
  }

  return environment.NODE_ENV === "production";
}
