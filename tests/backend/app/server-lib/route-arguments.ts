import { RouterContextProvider } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";

import type { User } from "@/definition/User";

/** Builds a route context that holds the given user, or none. */
export function contextFor(user: User | null): RouterContextProvider {
  const context = new RouterContextProvider();

  context.set(authenticatedUserContext, user);

  return context;
}

/**
 * Builds the argument object React Router hands to a loader or action.
 *
 * @param request - Request the route answers.
 * @param user - Signed-in user of the route context, or `null`.
 * @param params - Path parameters of the route.
 */
export function routeArguments<Params extends Record<string, string>>(
  request: Request,
  user: User | null,
  params: Params,
): {
  readonly request: Request;
  readonly context: RouterContextProvider;
  readonly params: Params;
  readonly url: URL;
  readonly pattern: string;
} {
  return {
    context: contextFor(user),
    params,
    pattern: "/synthetic",
    request,
    url: new URL(request.url),
  };
}
