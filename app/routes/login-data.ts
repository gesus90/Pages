import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as loginLoader } from "./login-server";

/** Answers the sign-in page, or its redirect for an active session (PAGE-235). */
export async function loader(
  args: Parameters<typeof loginLoader>[0],
): Promise<Response> {
  return routeDataResponse(await loginLoader(args));
}
