import { requireUserManagement } from "@/app/lib/auth.server";
import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as usersLoader } from "./users-server";

import type { MiddlewareFunction } from "react-router";

/**
 * Checks management access before the loader runs, as the management route does.
 *
 * @remarks
 * Calling the route's loader does not run the route's middleware, so the
 * endpoint names it itself; without it every signed-in account could read
 * the directory.
 */
export const middleware: MiddlewareFunction[] = [requireUserManagement];

/** Answers the server-filtered management view only to an account that may manage users. */
export async function loader(
  args: Parameters<typeof usersLoader>[0],
): Promise<Response> {
  return routeDataResponse(await usersLoader(args));
}
