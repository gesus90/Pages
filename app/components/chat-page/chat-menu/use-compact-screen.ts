import { useSyncExternalStore } from "react";

/** Below `md` the chat page shows the phone layout; the chat menu becomes a sheet. */
const COMPACT_QUERY = "(max-width: 767px)";

function compactQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return null;
  return window.matchMedia(COMPACT_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = compactQuery();
  if (query === null) return () => undefined;
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the screen is as narrow as a phone; `false` on the server and
 * where the browser cannot tell.
 */
export function useCompactScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => compactQuery()?.matches === true,
    () => false,
  );
}
