import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as picaToolsLoader } from "./pica-tools-server";

/** Answers whether the tools page offers the tools, with the administrator check of its route. */
export async function loader(
  args: Parameters<typeof picaToolsLoader>[0],
): Promise<Response> {
  return routeDataResponse(await picaToolsLoader(args));
}
