import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as setupLoader } from "./setup-server";

/** Answers the state of the setup wizard (PAGE-235). */
export async function loader(
  args: Parameters<typeof setupLoader>[0],
): Promise<Response> {
  return routeDataResponse(await setupLoader(args));
}
