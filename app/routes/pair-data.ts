import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as pairLoader } from "./pair-server";

/**
 * Answers the pairing view (PAGE-235).
 *
 * @remarks
 * A throttled code entry is the page's answer, not a failure: the view
 * carries `retryAfter`, so it is sent with `200`.
 */
export async function loader(
  args: Parameters<typeof pairLoader>[0],
): Promise<Response> {
  const view = await pairLoader(args);
  if (view.status !== 429) return routeDataResponse(view);
  return routeDataResponse(
    new Response(view.body, { status: 200, headers: view.headers }),
  );
}
