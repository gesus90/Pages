import { RouterContextProvider } from "react-router";

import { clientSocketAddressContext } from "@/app/lib/client-address.server";

/** Public address the synthetic MCP HTTP configuration trusts. */
export const MCP_PUBLIC_URL = "https://pages.invalid";

/** Socket address of a remote, non-loopback client. */
export const REMOTE_SOCKET = "203.0.113.7";

/**
 * Builds loader or action arguments of an MCP HTTP route.
 *
 * @remarks
 * MCP routes read no session; the context only holds the socket address the
 * server entry provides, so no authentication module is loaded.
 *
 * @param request - Request the route answers.
 * @param params - Path parameters of the route.
 */
export function mcpRouteArguments<
  Params extends Record<string, string | undefined>,
>(
  request: Request,
  params: Params,
): {
  readonly request: Request;
  readonly context: RouterContextProvider;
  readonly params: Params;
  readonly url: URL;
  readonly pattern: string;
} {
  const context = new RouterContextProvider();

  context.set(clientSocketAddressContext, REMOTE_SOCKET);

  return {
    context,
    params,
    pattern: "/synthetic",
    request,
    url: new URL(request.url),
  };
}
