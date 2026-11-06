import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as settingsLoader } from "./settings-server";

/** Answers which settings areas the navigation lists, with the checks of the settings frame. */
export async function loader(
  args: Parameters<typeof settingsLoader>[0],
): Promise<Response> {
  return routeDataResponse(await settingsLoader(args));
}
