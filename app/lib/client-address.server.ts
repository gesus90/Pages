/**
 * Reads the client address a reverse proxy reports for a request.
 *
 * @param request - Incoming request.
 * @returns The first address of `X-Forwarded-For`, or `null` without proxy.
 *
 * @remarks
 * The header can be sent by anyone when Pages is reachable without a proxy.
 * It is therefore only used as an additional key for login throttling and
 * never to grant access.
 */
export function getClientAddress(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstAddress = forwardedFor?.split(",")[0]?.trim();

  if (firstAddress === undefined || firstAddress === "") {
    return null;
  }

  return firstAddress;
}
