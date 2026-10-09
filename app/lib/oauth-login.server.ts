/** Preserves only an internal consent return path; arbitrary login redirects are rejected. */
export function oauthLoginDestination(request: Request): string {
  const destination = new URL(request.url).searchParams.get("returnTo") ?? "";
  return /^\/oauth\/consent\?id=[a-f0-9-]{36}$/.test(destination)
    ? destination
    : "/dashboard";
}
