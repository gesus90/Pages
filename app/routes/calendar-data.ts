import { routeDataResponse } from "@/app/lib/local-state/route-data.server";

import { loader as calendarLoader } from "./calendar-server";

/** Answers the visible range of the calendar page with the checks of its route (PAGE-301). */
export async function loader(
  args: Parameters<typeof calendarLoader>[0],
): Promise<Response> {
  return routeDataResponse(await calendarLoader(args));
}
