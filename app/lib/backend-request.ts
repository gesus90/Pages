import {
  UNSAFE_decodeViaTurboStream as decodeViaTurboStream,
  UNSAFE_ErrorResponseImpl as ErrorResponseImpl,
  UNSAFE_SingleFetchRedirectSymbol as SingleFetchRedirectSymbol,
  redirect,
} from "react-router";

/**
 * Marks a request of the static app for one of the API's data endpoints (PAGE-235).
 *
 * @remarks
 * The API answers a redirect to such a request with `204` and
 * {@link REDIRECT_HEADER} instead of `3xx`, so the browser does not load the
 * target, and the app navigates there itself.
 */
export const DATA_REQUEST_HEADER = "X-Pages-Data-Request";

/** The target of a redirect the API answered a data request with. */
export const REDIRECT_HEADER = "X-Pages-Redirect";

/** Answers without a body. */
const NO_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/** A redirect as React Router's data protocol describes it. */
interface DataRedirect {
  readonly redirect: string;
  readonly status: number;
  readonly revalidate: boolean;
  readonly reload: boolean;
  readonly replace: boolean;
}

/** One route's answer in React Router's data protocol. */
type RouteResult = { readonly data: unknown } | { readonly error: unknown };

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isDataRedirect(value: unknown): value is DataRedirect {
  return (
    isRecord(value) &&
    typeof value.redirect === "string" &&
    typeof value.status === "number"
  );
}

function isRouteResult(value: unknown): value is RouteResult {
  return isRecord(value) && ("data" in value || "error" in value);
}

/**
 * The headers of a request of the static app to a data endpoint.
 *
 * @param init - Headers the caller sends as well.
 */
export function backendRequestHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set(DATA_REQUEST_HEADER, "1");
  return headers;
}

/**
 * The redirect a data endpoint's answer asks for, if any.
 *
 * @param response - The API's answer to a request with {@link DATA_REQUEST_HEADER}.
 * @returns A redirect of the app, or `null`.
 */
export function backendRedirect(response: Response): Response | null {
  const location = response.headers.get(REDIRECT_HEADER);
  if (location !== null) return redirect(location);
  // A proxy in between may still follow; the app then goes where it ended.
  if (!response.redirected) return null;
  const target = new URL(response.url);
  return redirect(`${target.pathname}${target.search}`);
}

function appRedirect(target: DataRedirect): Response {
  return redirect(target.redirect, {
    status: target.status,
    headers: {
      ...(target.revalidate ? { "X-Remix-Revalidate": "yes" } : null),
      ...(target.reload ? { "X-Remix-Reload-Document": "yes" } : null),
      ...(target.replace ? { "X-Remix-Replace": "yes" } : null),
    },
  });
}

/** The address of a route's data in React Router's data protocol. */
function dataUrl(request: Request): URL {
  const url = new URL(request.url);
  url.pathname = url.pathname.endsWith("/")
    ? `${url.pathname}_.data`
    : `${url.pathname}.data`;
  if (request.method === "GET") {
    const kept = url.searchParams.getAll("index").filter(Boolean);
    url.searchParams.delete("index");
    for (const value of kept) url.searchParams.append("index", value);
  }
  return url;
}

async function requestBody(request: Request): Promise<Blob | null> {
  if (request.method === "GET" || request.method === "HEAD") return null;
  return request.blob();
}

/** The one route answer of a loader read; the API's layouts have no loaders. */
function loaderResult(value: Record<PropertyKey, unknown>): RouteResult | null {
  const results = Object.values(value).filter(isRouteResult);
  return results.at(-1) ?? null;
}

/** The route answer of a change. */
function actionResult(value: Record<PropertyKey, unknown>): RouteResult | null {
  return isRouteResult(value) ? value : null;
}

function unwrap(result: RouteResult | null): unknown {
  if (result === null) throw new Error("The API answered without a result.");
  if ("error" in result) throw result.error;
  return result.data;
}

/**
 * Sends a route request of the app to the API at the same address.
 *
 * @remarks
 * Used where the server answers a request that the router sent to it while
 * Pages rendered on the server: a page's change, or a load or change of a
 * server resource. It speaks React Router's own data protocol with the API,
 * so a returned answer stays the route's data and a thrown one its error,
 * with the same status, and a redirect becomes a redirect of the app. A
 * failed connection throws a `TypeError`.
 *
 * @param request - The router's request, with its method, body and cancellation.
 * @returns The answer of the API's route.
 * @throws Response - A redirect of the app.
 * @throws ErrorResponse - The error the API's route answered with.
 */
export async function sendToBackend(request: Request): Promise<unknown> {
  const headers = new Headers();
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  const response = await fetch(dataUrl(request), {
    body: await requestBody(request),
    cache: "no-store",
    credentials: "same-origin",
    headers,
    method: request.method,
    signal: request.signal,
  });
  if (response.status >= 400 && !response.headers.has("X-Remix-Response"))
    throw new ErrorResponseImpl(
      response.status,
      response.statusText,
      await response.text(),
    );
  const location = response.headers.get("X-Remix-Redirect");
  if (location !== null)
    throw appRedirect({
      redirect: location,
      status: Number(response.headers.get("X-Remix-Status") ?? "302"),
      revalidate: response.headers.get("X-Remix-Revalidate") === "true",
      reload: response.headers.get("X-Remix-Reload-Document") === "true",
      replace: response.headers.get("X-Remix-Replace") === "true",
    });
  if (NO_BODY_STATUSES.has(response.status) || !response.body) return null;
  const decoded = await decodeViaTurboStream(response.body, window);
  const value: unknown = decoded.value;
  if (!isRecord(value)) throw new Error("The API answered in another form.");
  const target = value[SingleFetchRedirectSymbol] ?? value;
  if (isDataRedirect(target)) throw appRedirect(target);
  return unwrap(
    request.method === "GET" ? loaderResult(value) : actionResult(value),
  );
}
