import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as dashboardLoader } from "./dashboard-server";

/** Answers the dashboard with the checks of the dashboard route (PAGE-235). */
export async function loader(
  args: Parameters<typeof dashboardLoader>[0],
): Promise<Response> {
  return routeDataResponse(await dashboardLoader(args));
}
