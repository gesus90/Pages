import { matchRoutes } from "react-router";

/** One address pattern of the static app's route table (PAGE-235). */
export interface AppRoute {
  /** Full path pattern, as React Router matches it. */
  readonly path: string;
  /** Whether the API answers the address; otherwise the app renders it. */
  readonly isForwarded: boolean;
}

/** Data requests of React Router end in `.data`; the API answers them. */
const DATA_REQUEST_SUFFIX = ".data";

/**
 * Whether the API answers a request, rather than the static app's document.
 *
 * @param routes - The static app's route list.
 * @param method - The request method.
 * @param pathname - The request path, decoded.
 * @returns `true` for changes, data requests and server resources.
 */
export function isForwardedRoute(
  routes: readonly AppRoute[],
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return true;
  if (pathname.endsWith(DATA_REQUEST_SUFFIX)) return true;
  const match = matchRoutes([...routes], pathname)?.at(-1);
  return match?.route.isForwarded ?? false;
}
