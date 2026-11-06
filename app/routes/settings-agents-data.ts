import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as settingsAgentsLoader } from "./settings-agents-server";

/** Answers the secret-free agents metadata only to an administrator in the admin mode, as its route does. */
export async function loader(
  args: Parameters<typeof settingsAgentsLoader>[0],
): Promise<Response> {
  return routeDataResponse(await settingsAgentsLoader(args));
}
