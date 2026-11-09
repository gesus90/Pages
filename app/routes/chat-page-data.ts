import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as chatPageLoader } from "./chat-page-server";

/** Answers the chat page of the signed-in person, as the page's server loader reads it. */
export async function loader(
  args: Parameters<typeof chatPageLoader>[0],
): Promise<Response> {
  return routeDataResponse(await chatPageLoader(args));
}
