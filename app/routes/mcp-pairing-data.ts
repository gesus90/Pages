import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as pairingLoader } from "./mcp-pairing-server";

/** Answers the pairing page, or its redirect to the sign-in (PAGE-243). */
export async function loader(
  args: Parameters<typeof pairingLoader>[0],
): Promise<Response> {
  return routeDataResponse(await pairingLoader(args));
}
