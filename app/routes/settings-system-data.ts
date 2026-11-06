import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as settingsSystemLoader } from "./settings-system-server";

/** Answers the system settings only to an administrator in the admin mode, as their route does. */
export async function loader(
  args: Parameters<typeof settingsSystemLoader>[0],
): Promise<Response> {
  return routeDataResponse(await settingsSystemLoader(args));
}
