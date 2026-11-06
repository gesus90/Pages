import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as taskDetailLoader } from "./task-detail-server";

/** Answers one ticket page with the checks of the ticket route; a refused ticket stays `404`. */
export async function loader(
  args: Parameters<typeof taskDetailLoader>[0],
): Promise<Response> {
  return routeDataResponse(await taskDetailLoader(args));
}
