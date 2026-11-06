import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as tasksLoader } from "./tasks-server";

/** Answers the board with the checks of the board route; the query selects as on the page. */
export async function loader(
  args: Parameters<typeof tasksLoader>[0],
): Promise<Response> {
  return routeDataResponse(await tasksLoader(args));
}
