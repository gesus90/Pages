import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as settingsProfileLoader } from "./settings-profile-server";

/** Answers the personal settings of the signed-in account and session, with the checks of their route. */
export async function loader(
  args: Parameters<typeof settingsProfileLoader>[0],
): Promise<Response> {
  return routeDataResponse(await settingsProfileLoader(args));
}
