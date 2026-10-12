import { oauthResponse } from "@/app/lib/oauth-response.server";

/** Removed browser API; even a direct invocation cannot issue or rotate credentials. */
export function loader(): Response {
  return oauthResponse({ error: "not_found" }, 404);
}

/** Keeps the old module fail-closed for callers migrating to device pairing. */
export function action(): Response {
  return loader();
}
