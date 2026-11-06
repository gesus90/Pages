import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as wikiHomeLoader } from "./wiki-home-server";

/** Answers the wiki start page with the checks of its route: only pages the account may see. */
export async function loader(
  args: Parameters<typeof wikiHomeLoader>[0],
): Promise<Response> {
  return routeDataResponse(await wikiHomeLoader(args));
}
