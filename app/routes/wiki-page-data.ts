import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as wikiPageLoader } from "./wiki-page-server";

/**
 * Answers one wiki page with the checks of the page route.
 *
 * @remarks
 * A page the account may not see answers as a missing one, without its
 * content, comments or attachments.
 */
export async function loader(
  args: Parameters<typeof wikiPageLoader>[0],
): Promise<Response> {
  return routeDataResponse(await wikiPageLoader(args));
}
