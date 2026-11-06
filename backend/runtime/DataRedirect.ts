import {
  DATA_REQUEST_HEADER,
  REDIRECT_HEADER,
} from "@/app/lib/backend-request";

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/**
 * Turns a redirect to a data request of the static app into an answer.
 *
 * @param request - The request the application answered.
 * @param response - The application's answer.
 * @returns For a request with {@link DATA_REQUEST_HEADER} answered by a
 * redirect: `204` with {@link REDIRECT_HEADER} and every other header of the
 * redirect, such as `Set-Cookie`. Every other answer unchanged.
 *
 * @remarks
 * A browser follows a redirect by itself and would load the target, often
 * a page whose document is the static app, before the app could navigate
 * there (PAGE-235). Other clients, such as Pica Mobile or MCP clients,
 * never send the header and keep getting real redirects.
 */
export function answerDataRedirect(
  request: Request,
  response: Response,
): Response {
  if (!request.headers.has(DATA_REQUEST_HEADER)) return response;
  const location = response.headers.get("Location");
  if (!REDIRECT_STATUSES.has(response.status) || location === null)
    return response;
  const headers = new Headers(response.headers);
  headers.delete("Location");
  headers.set(REDIRECT_HEADER, location);
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status: 204, headers });
}
