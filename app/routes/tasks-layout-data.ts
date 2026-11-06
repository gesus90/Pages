import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as ticketLayoutLoader } from "./tasks-layout-server";

/** Answers the ticket tree of the sidebar with the checks of the ticket layout. */
export async function loader(
  args: Parameters<typeof ticketLayoutLoader>[0],
): Promise<Response> {
  return routeDataResponse(await ticketLayoutLoader(args));
}
