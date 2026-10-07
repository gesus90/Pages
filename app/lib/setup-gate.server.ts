import { redirect } from "react-router";

import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import type { MiddlewareFunction } from "react-router";

/** Paths that stay reachable while the setup is pending. */
const PATHS_DURING_SETUP: ReadonlySet<string> = new Set([
  "/health",
  "/set-language",
  "/setup",
]);

const DATA_REQUEST_SUFFIX = ".data";

/** Data requests of client navigations append `.data` to the route path. */
function readRoutePath(requestUrl: string): string {
  const { pathname } = new URL(requestUrl);

  return pathname.endsWith(DATA_REQUEST_SUFFIX)
    ? pathname.slice(0, -DATA_REQUEST_SUFFIX.length)
    : pathname;
}

/**
 * Tells whether the instance still waits for its setup.
 *
 * @returns Whether only the setup wizard is available.
 */
export async function isSetupPending(): Promise<boolean> {
  return (await getPagesRuntime()).isSetupPending();
}

/**
 * Sends every request to the setup wizard while the setup is pending.
 *
 * @remarks
 * Runs before any loader or action, so no route opens the database of an
 * instance that has none yet.
 */
export const requireFinishedSetup: MiddlewareFunction = async (
  { request },
  next,
) => {
  if (
    !(await isSetupPending()) ||
    PATHS_DURING_SETUP.has(readRoutePath(request.url))
  ) {
    return next();
  }

  throw redirect("/setup");
};
