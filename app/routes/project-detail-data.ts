import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as projectDetailLoader } from "./project-detail-server";

/** Answers one project page with the checks of the project route; a refused project stays `403`. */
export async function loader(
  args: Parameters<typeof projectDetailLoader>[0],
): Promise<Response> {
  return routeDataResponse(await projectDetailLoader(args));
}
