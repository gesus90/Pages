import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as wikiTrashLoader } from "./wiki-trash-server";

/** Answers the wiki trash with the checks of its route: only pages the account may restore. */
export async function loader(
  args: Parameters<typeof wikiTrashLoader>[0],
): Promise<Response> {
  return routeDataResponse(await wikiTrashLoader(args));
}
