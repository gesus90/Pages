import type { UNSAFE_DataWithResponseInit as DataWithResponseInit } from "react-router";

/** Route data is private to the signed-in account and must not be kept by any cache. */
const ROUTE_DATA_HEADERS = { "Cache-Control": "no-store" } as const;

/** Whether a loader answered with `data(…)`, which carries its own status and headers. */
function isDataWithResponseInit(
  value: object,
): value is DataWithResponseInit<unknown> {
  return (
    "type" in value &&
    value.type === "DataWithResponseInit" &&
    "data" in value &&
    "init" in value
  );
}

/** The loader's headers, kept uncacheable whatever they said before. */
function routeDataHeaders(init: HeadersInit | undefined): Headers {
  const headers = new Headers(init);
  headers.set("Cache-Control", ROUTE_DATA_HEADERS["Cache-Control"]);
  return headers;
}

/**
 * Answers a route's data endpoint with what the route's own loader returns.
 *
 * @remarks
 * The endpoint runs the same loader as the page, so the same permission
 * checks decide; a refusal the loader throws reaches the browser unchanged.
 * A loader may answer with plain data, with `data(…)` or with a finished
 * JSON response; the endpoint sends the data itself in every case, with the
 * loader's status and headers.
 *
 * @param routeData - The loader's answer for the signed-in account.
 */
export function routeDataResponse(routeData: object): Response {
  if (routeData instanceof Response)
    return new Response(routeData.body, {
      status: routeData.status,
      statusText: routeData.statusText,
      headers: routeDataHeaders(routeData.headers),
    });
  if (isDataWithResponseInit(routeData))
    return Response.json(routeData.data, {
      status: routeData.init?.status ?? 200,
      headers: routeDataHeaders(routeData.init?.headers),
    });
  return Response.json(routeData, { headers: ROUTE_DATA_HEADERS });
}
