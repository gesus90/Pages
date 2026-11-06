import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as projectsLoader } from "./projects-server";

/** Answers the project overview with the checks of the overview route. */
export async function loader(
  args: Parameters<typeof projectsLoader>[0],
): Promise<Response> {
  return routeDataResponse(await projectsLoader(args));
}
