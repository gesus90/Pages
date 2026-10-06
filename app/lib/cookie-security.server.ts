/**
 * Tells whether a request reached Pages over HTTPS.
 *
 * @remarks
 * A reverse proxy that ends TLS reports the original protocol in
 * `X-Forwarded-Proto`. The header only decides the `Secure` attribute of
 * the cookies sent back to the same client, so a forged value cannot grant
 * anything.
 */
function isHttpsRequest(request: Request): boolean {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();

  if (forwardedProtocol !== undefined && forwardedProtocol !== "") {
    return forwardedProtocol === "https";
  }

  return new URL(request.url).protocol === "https:";
}

/**
 * Decides whether the cookies for a response carry the `Secure` attribute.
 *
 * @param request - Request the response answers.
 * @param environment - Process environment to read from.
 * @returns Whether browsers may only send the cookies over HTTPS.
 *
 * @remarks
 * By default the attribute follows the protocol of the request: browsers
 * drop `Secure` cookies on plain HTTP outside of localhost, which would
 * sign nobody in on a self-hosted installation reached through its network
 * address. `PAGES_COOKIE_SECURE=true|false` overrides the default.
 */
export function resolveCookieSecure(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = environment.PAGES_COOKIE_SECURE?.trim().toLowerCase();

  if (configured === "true") {
    return true;
  }

  if (configured === "false") {
    return false;
  }

  return isHttpsRequest(request);
}
