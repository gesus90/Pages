import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as settingsAgentToolsLoader } from "./settings-agent-tools-server";

/** Answers the tool inventory with the fresh administrator check of its route. */
export async function loader(
  args: Parameters<typeof settingsAgentToolsLoader>[0],
): Promise<Response> {
  return routeDataResponse(await settingsAgentToolsLoader(args));
}
