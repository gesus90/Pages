import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as automationsLoader } from "./automations-server";

/** Answers the data of the page `/automationen` for the static app (PAGE-297). */
export async function loader(
  args: Parameters<typeof automationsLoader>[0],
): Promise<Response> {
  return routeDataResponse(await automationsLoader(args));
}
