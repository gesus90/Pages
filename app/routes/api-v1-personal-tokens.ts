import { authorizationResponse } from "@/app/lib/authorization-response.server";

/** Removed browser API; even a direct invocation cannot issue or rotate credentials. */
export function loader(): Response {
  return authorizationResponse({ error: "not_found" }, 404);
}

/** Keeps the old module fail-closed for callers migrating to device pairing. */
export function action(): Response {
  return loader();
}
