import { useEffect, useRef, useState } from "react";
import { useLocation, useRevalidator } from "react-router";

import { openLiveConnection } from "@/app/lib/live-changes/live-change-connection";
import { revalidateLive } from "@/app/lib/live-changes/live-revalidation";

import type { LiveChange, LiveChangeKind } from "@/definition/LiveChange";

/** Gathers a burst of notices into one reading of the page. */
const GATHER_MILLISECONDS = 100;
/** The slow fallback while no stream is open after a gap. */
const FALLBACK_MILLISECONDS = 60_000;

/** The pages that show objects of a kind. */
const PATHS_BY_KIND: Readonly<Record<LiveChangeKind, readonly string[]>> = {
  ticket: ["/tasks", "/aufgaben", "/projekte", "/dashboard"],
  milestone: ["/tasks", "/aufgaben", "/projekte", "/dashboard"],
  wiki: ["/wiki"],
  project: ["/tasks", "/aufgaben", "/projekte", "/dashboard"],
  conversation: ["/chat"],
};

function concerns(change: LiveChange, pathname: string): boolean {
  return PATHS_BY_KIND[change.kind].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Reads the page again at most once at a time, and once more for what came meanwhile. */
function useGatheredRevalidation(): () => void {
  const { revalidate } = useRevalidator();
  const revalidateRef = useRef(revalidate);
  useEffect(() => {
    revalidateRef.current = revalidate;
  }, [revalidate]);
  const stateRef = useRef({
    timer: 0,
    isRunning: false,
    isDue: false,
    isUnmounted: false,
  });
  useEffect(() => {
    const state = stateRef.current;
    state.isUnmounted = false;
    return () => {
      // A reading still under way must not start another one after unmount.
      state.isUnmounted = true;
      window.clearTimeout(state.timer);
      state.timer = 0;
      state.isDue = false;
    };
  }, []);
  const scheduleRef = useRef(function schedule(): void {
    const state = stateRef.current;
    if (state.isUnmounted) return;
    if (state.isRunning) {
      state.isDue = true;
      return;
    }
    if (state.timer) return;
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      state.isRunning = true;
      void revalidateLive(revalidateRef.current).finally(() => {
        state.isRunning = false;
        if (!state.isDue) return;
        state.isDue = false;
        schedule();
      });
    }, GATHER_MILLISECONDS);
  });
  return scheduleRef.current;
}

/**
 * Follows the live notices of the signed-in account and reads the page again when they concern it.
 *
 * @remarks
 * The notices name only kind and id; the data comes from the page's own
 * rights-checked loaders. Every opening of the stream, the first one
 * included, reads the whole page once, so a change between the page's
 * loading and the subscription is not missed. While no stream is open,
 * because the browser has no `EventSource` or the stream failed, the page is
 * read again every minute as a slow fallback; a healthy stream asks nothing
 * between changes.
 *
 * @param version - The authorization fingerprint the page was loaded with.
 * @param onChatChange - Refreshes notification previews on conversation changes and resyncs.
 * @returns Whether notices arrive right now.
 */
export function useLiveChanges(
  version: string,
  onChatChange?: () => void,
): boolean {
  const [isLive, setIsLive] = useState(false);
  const [needsFallback, setNeedsFallback] = useState(false);
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const schedule = useGatheredRevalidation();
  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setNeedsFallback(true);
      return undefined;
    }
    return openLiveConnection(version, {
      onChange: (change) => {
        if (change.kind === "conversation") onChatChange?.();
        if (concerns(change, pathnameRef.current)) schedule();
      },
      onResync: () => {
        schedule();
        onChatChange?.();
      },
      onLiveChange: (next) => {
        setIsLive(next);
        if (!next) setNeedsFallback(true);
      },
    });
  }, [version, schedule, onChatChange]);
  useEffect(() => {
    if (isLive || !needsFallback) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") schedule();
    }, FALLBACK_MILLISECONDS);
    return () => window.clearInterval(timer);
  }, [isLive, needsFallback, schedule]);
  return isLive;
}
