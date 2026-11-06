import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as agentPlansLoader } from "./agent-plans-server";

/**
 * Answers the plan page with the checks of the plan route.
 *
 * @remarks
 * A missing or refused plan stays the empty editor with its notice; a plain
 * address is still sent to the plan it opens.
 */
export async function loader(
  args: Parameters<typeof agentPlansLoader>[0],
): Promise<Response> {
  return routeDataResponse(await agentPlansLoader(args));
}
