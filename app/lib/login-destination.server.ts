/** Preserves the internal pairing return path after login. */
export function loginDestination(request: Request): string {
  const destination = new URL(request.url).searchParams.get("returnTo") ?? "";
  return /^\/pair(?:\?code=[BCDFGHJKLMNPQRSTVWXZ]{8})?$/.test(destination) ||
    /^\/mcp-login\?request=[A-Za-z0-9_-]{43}$/.test(destination)
    ? destination
    : "/dashboard";
}
