import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as settingsConnectionsLoader } from "./settings-connections-server";

/** Answers the owner's connection metadata with the checks of the connections route; never a token. */
export async function loader(
  args: Parameters<typeof settingsConnectionsLoader>[0],
): Promise<Response> {
  return routeDataResponse(await settingsConnectionsLoader(args));
}
