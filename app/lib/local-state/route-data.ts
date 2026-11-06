import {
  backendRedirect,
  backendRequestHeaders,
} from "@/app/lib/backend-request";

/** How a route reads its data from its rights-checked endpoint. */
export interface RouteDataRequest<T> {
  /** Path and query of the endpoint. */
  readonly endpoint: string;
  /** Ends the request when the route load is cancelled. */
  readonly signal: AbortSignal;
  readonly isPayload: (value: unknown) => value is T;
}

/**
 * Reads a route's data from its endpoint the way the route's server loader answers.
 *
 * @remarks
 * A refusal or an error is thrown as a response with the endpoint's status,
 * so the route shows the same error page as before. An endpoint that sends
 * the visitor elsewhere, such as to the sign-in page when the session ended,
 * becomes a redirect of the route; the API sends it as an answer instead of
 * a redirect the browser follows (PAGE-235). A failed connection throws a
 * `TypeError`.
 *
 * @param request - The endpoint, the cancellation and the expected shape.
 * @returns The data exactly as the server checked it for the signed-in account.
 * @throws Response - With the endpoint's status, or a redirect.
 */
export async function readRouteData<T>(
  request: RouteDataRequest<T>,
): Promise<T> {
  const response = await fetch(request.endpoint, {
    cache: "no-store",
    headers: backendRequestHeaders({ Accept: "application/json" }),
    signal: request.signal,
  });
  const redirection = backendRedirect(response);
  if (redirection) throw redirection;
  if (!response.ok) {
    const headers = new Headers();
    const contentType = response.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);
    throw new Response(await response.text(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const payload: unknown = await response.json();
  if (!request.isPayload(payload))
    throw new Response("Unexpected route data", { status: 500 });
  return payload;
}
