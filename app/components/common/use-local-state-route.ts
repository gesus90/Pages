import { useEffect, useRef } from "react";
import { useFetcher, useLocation } from "react-router";

import { markLocalStateRouteOpen } from "@/app/lib/local-state/local-state-loader";
import { localState } from "@/app/lib/local-state/local-state-store";

import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { LocalStateKind } from "@/app/lib/local-state/local-state-store";

const OFFLINE_RETRY_MS = 15_000;

/** How a route keeps its answers and recognizes their account and a refused access. */
export interface LocalStateRouteKind<T> extends LocalStateKind<T> {
  readonly ownerOf: (payload: T) => string;
  /** Whether the answer says the account may not see the route; it is then removed, not kept. */
  readonly isRefused: (payload: T) => boolean;
  /** Whether the route is an index route; its refresh then names it, not its layout. */
  readonly isIndex?: boolean;
}

/** The address a fetcher loads the route with; a bare path would load an index route's layout. */
function fetcherTarget(
  pathname: string,
  search: string,
  isIndex: boolean,
): string {
  if (!isIndex) return `${pathname}${search}`;
  return `${pathname}?index${search ? `&${search.slice(1)}` : ""}`;
}

/**
 * Shows a route's kept answer until the server's answer arrives and keeps every answer it shows.
 *
 * @remarks
 * A kept answer asks the server again at once; while the backend is
 * unreachable it asks again every 15 seconds. Only answers of the server are
 * kept, and only after they were shown, so a cancelled load leaves no trace.
 *
 * @param loaded - The route's loader data.
 * @param kind - The stored form of the route's answers.
 * @returns The answer to show, marked when it is a kept one.
 */
export function useLocalStateRoute<T extends object>(
  loaded: WithLocalState<T>,
  kind: LocalStateRouteKind<T>,
): WithLocalState<T> {
  const location = useLocation();
  const route = `${location.pathname}${location.search}`;
  const target = fetcherTarget(
    location.pathname,
    location.search,
    kind.isIndex === true,
  );
  // Once the loader answers itself the fetcher is retired: React Router keeps
  // revalidating a fetcher that has loaded, even after a reset, so the route
  // would be read twice on every later revalidation, such as a poll.
  const isLoaderCurrent = !loaded.localState;
  // One fetcher per opening, so a later opening never shows an earlier route's answer.
  const fetcher = useFetcher({
    key: `local-state:${location.key}${isLoaderCurrent ? ":current" : ""}`,
  });
  const { load, state: fetcherState } = fetcher;
  const fetched: unknown = fetcher.data;
  function isAnswer(value: unknown): value is WithLocalState<T> {
    return kind.isPayload(value);
  }
  const shown = loaded.localState && isAnswer(fetched) ? fetched : loaded;
  const shownState = shown.localState?.state;
  useEffect(() => markLocalStateRouteOpen(route), [route]);
  useEffect(() => {
    if (shownState === "stale" && fetcherState === "idle" && !fetched) {
      void load(target);
      return;
    }
    if (shownState !== "offline") return;
    const timer = window.setInterval(() => void load(target), OFFLINE_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [shownState, fetcherState, fetched, load, target]);
  // An answer belongs to the address it was loaded for. A route that keeps
  // its data while only the address changes, such as a board filter, must
  // not keep that data for the new address.
  const keptRef = useRef<object | null>(null);
  useEffect(() => {
    if (shown.localState || keptRef.current === shown) return;
    keptRef.current = shown;
    if (kind.isRefused(shown)) void localState.remove(route);
    else void localState.save(kind.ownerOf(shown), route, kind, shown);
  }, [shown, route, kind]);
  return shown;
}
