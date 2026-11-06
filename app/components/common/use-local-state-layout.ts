import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRevalidator } from "react-router";

import { markLocalStateRouteOpen } from "@/app/lib/local-state/local-state-loader";
import { localState } from "@/app/lib/local-state/local-state-store";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";

const OFFLINE_RETRY_MS = 15_000;

/** The endpoint's answer to the kept answer it replaces. */
export interface Refreshed<T> {
  readonly of: object;
  readonly answer: T;
}

/** The endpoint's last answer of one layout, shared by every component that shows the layout. */
export interface LocalStateLayoutAnswers<T> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly current: () => Refreshed<T> | null;
  readonly replace: (next: Refreshed<T>) => void;
}

/** Where a layout keeps its answers and how it asks its endpoint for them. */
export interface LocalStateLayoutSource<T> {
  /** The key of the layout's answers; a layout's data does not depend on the address. */
  readonly route: string;
  readonly read: (signal: AbortSignal) => Promise<T>;
  readonly answers: LocalStateLayoutAnswers<T>;
}

/**
 * Creates the holder of a layout's refreshed answer.
 *
 * @remarks
 * Components outside the route, such as the sidebar, and the route itself
 * read the same answer, so the endpoint is asked once for all of them.
 */
export function createLocalStateLayoutAnswers<T>(): LocalStateLayoutAnswers<T> {
  let refreshed: Refreshed<T> | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current: () => refreshed,
    replace: (next) => {
      refreshed = next;
      for (const listener of listeners) listener();
    },
  };
}

function noAnswer(): null {
  return null;
}

/**
 * The layout's answer to show: the endpoint's answer to the kept one, or the loader's.
 *
 * @remarks
 * Reads only; {@link useLocalStateLayout} asks the endpoint and keeps the answers.
 *
 * @param loaded - The layout's loader data, or `undefined` outside the layout.
 * @param source - The holder of the layout's refreshed answer.
 */
export function useLocalStateLayoutAnswer<T extends object>(
  loaded: WithLocalState<T> | undefined,
  source: Pick<LocalStateLayoutSource<T>, "answers">,
): WithLocalState<T> | undefined {
  const { subscribe, current } = source.answers;
  const refreshed = useSyncExternalStore(subscribe, current, noAnswer);
  return loaded && refreshed?.of === loaded ? refreshed.answer : loaded;
}

/** Whether a failed refresh means the backend could not be reached, so a later try may succeed. */
function isUnreachable(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Response && error.status >= 500)
  );
}

/**
 * Whether an endpoint's answer belongs to the signed-in account under its current rights.
 *
 * @param kind - The stored form of the layout's answers.
 * @param answer - The endpoint's answer.
 */
function isShowable<T>(kind: LocalStateRouteKind<T>, answer: T): boolean {
  if (localState.isSuperseded()) return false;
  if (kind.isCurrent) return kind.isCurrent(answer);
  return kind.ownerOf(answer) === localState.currentOwner();
}

/**
 * Asks a layout's endpoint for the answer that replaces a shown one.
 *
 * @remarks
 * Every component of the layout shows the answer, so a late answer given to
 * an account that signed out meanwhile, or under rights changed meanwhile,
 * reaches none of them; the layout is read again instead.
 *
 * @param of - The loader data the answer replaces.
 * @param layout - The stored form of the answers, the endpoint reader and the holder of the answer.
 * @param onRefused - Called when the endpoint refuses, such as after the session ended.
 * @returns Ends the request and a pending retry.
 */
function refreshLayout<T>(
  of: object,
  layout: {
    readonly kind: LocalStateRouteKind<T>;
    readonly source: LocalStateLayoutSource<T>;
  },
  onRefused: () => void,
): () => void {
  const { kind, source } = layout;
  const controller = new AbortController();
  let timer = 0;
  async function refresh(): Promise<void> {
    try {
      const answer = await source.read(controller.signal);
      if (controller.signal.aborted) return;
      if (!isShowable(kind, answer)) {
        onRefused();
        return;
      }
      source.answers.replace({ of, answer });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      if (!isUnreachable(error)) {
        onRefused();
        return;
      }
      timer = window.setTimeout(() => void refresh(), OFFLINE_RETRY_MS);
    }
  }
  void refresh();
  return () => {
    controller.abort();
    window.clearTimeout(timer);
  };
}

/**
 * Shows a layout's kept answer until its endpoint answers and keeps every answer it shows.
 *
 * @remarks
 * A layout's data is read by components outside the route, which a fetcher
 * of the address would not reach, so the endpoint is asked directly. While
 * the backend is unreachable it asks again every 15 seconds. A refusal, such
 * as an ended session, reads the page again, so the layout's own loader
 * passes it on as before. Other components read the same answer through
 * {@link useLocalStateLayoutAnswer}. A layout the router does not reload
 * when the person moves inside it names the address as `refreshKey`; every
 * change of it asks the endpoint again behind the shown answer.
 *
 * @param loaded - The layout's loader data, or `undefined` outside the layout.
 * @param kind - The stored form of the layout's answers.
 * @param source - The key of the answers and the endpoint reader.
 * @param refreshKey - Asks the endpoint again whenever it changes; optional.
 * @returns The answer to show, marked when it is a kept one.
 */
export function useLocalStateLayout<T extends object>(
  loaded: WithLocalState<T> | undefined,
  kind: LocalStateRouteKind<T>,
  source: LocalStateLayoutSource<T>,
  refreshKey?: string,
): WithLocalState<T> | undefined {
  const { route } = source;
  const { revalidate } = useRevalidator();
  const reload = useCallback(() => void revalidate(), [revalidate]);
  const shown = useLocalStateLayoutAnswer(loaded, source);
  const isInLayout = loaded !== undefined;
  const pending = loaded?.localState && shown === loaded ? loaded : null;
  useEffect(
    () => (isInLayout ? markLocalStateRouteOpen(route) : undefined),
    [isInLayout, route],
  );
  useEffect(
    () =>
      pending ? refreshLayout(pending, { kind, source }, reload) : undefined,
    [pending, kind, source, reload],
  );
  // The first key is the address the layout was loaded for.
  const refreshedKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (!loaded || refreshedKeyRef.current === refreshKey) return undefined;
    refreshedKeyRef.current = refreshKey;
    return refreshLayout(loaded, { kind, source }, reload);
  }, [loaded, refreshKey, kind, source, reload]);
  const keptRef = useRef<object | null>(null);
  useEffect(() => {
    if (!shown || shown.localState || keptRef.current === shown) return;
    keptRef.current = shown;
    if (kind.isRefused(shown)) void localState.remove(route);
    else void localState.save(kind.ownerOf(shown), route, kind, shown);
  }, [shown, route, kind]);
  return shown;
}
