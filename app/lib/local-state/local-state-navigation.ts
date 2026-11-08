import type { ShouldRevalidateFunctionArgs } from "react-router";

/** Routes that open from the browser's local state and refresh themselves. */
const LOCAL_STATE_PATHS: readonly RegExp[] = [
  /^\/agents\/(?:plans|workspaces|agents)$/,
  /^\/(?:dashboard|users)$/,
  /^\/settings(?:\/[^/]+){0,2}$/,
  /^\/(?:aufgaben|tasks)(?:\/[^/]+)?$/,
  /^\/projekte(?:\/[^/]+)?$/,
  /^\/wiki(?:\/[^/]+){0,2}$/,
];

/**
 * Whether a navigation opens a local-state route, which the shell's loaders need not wait for.
 *
 * @remarks
 * The shell's data does not depend on the address. Reading it again would
 * make the opening wait for the server and fail while the backend is
 * unreachable. Actions, explicit revalidation and the authorization refresh
 * still read it.
 */
export function isLocalStateNavigation(
  args: ShouldRevalidateFunctionArgs,
): boolean {
  const { pathname } = args.nextUrl;
  return (
    args.formMethod === undefined &&
    args.actionResult === undefined &&
    LOCAL_STATE_PATHS.some((path) => path.test(pathname)) &&
    args.currentUrl.href !== args.nextUrl.href
  );
}
