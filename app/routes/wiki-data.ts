import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as wikiLoader } from "./wiki-server";

/** Answers the wiki frame with the checks of the wiki route: the tree only holds visible pages. */
export async function loader(
  args: Parameters<typeof wikiLoader>[0],
): Promise<Response> {
  return routeDataResponse(await wikiLoader(args));
}
