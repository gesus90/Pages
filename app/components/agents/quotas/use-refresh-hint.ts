import { useEffect, useRef, useState } from "react";

/** How long a refresh runs before the card says so. */
const SHOW_AFTER_MILLISECONDS = 400;

/** How long the hint stays once it showed, so it never flashes. */
const SHOW_AT_LEAST_MILLISECONDS = 600;

/**
 * Whether the hint "wird aktualisiert" shows for a refresh that may be quick.
 * @param isRefreshing - Whether the card waits for its refresh.
 * @returns `true` once the refresh has run 400 ms, and for at least 600 ms
 * after the hint appeared. A refresh that answers sooner shows no hint at
 * all, so a quick answer causes no change.
 * @remarks
 * Every card calls this for itself, so a slow card never holds back the
 * hint of another one.
 */
export function useRefreshHint(isRefreshing: boolean): boolean {
  const [isShown, setIsShown] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (isRefreshing) {
      // A hint that is already up simply stays up.
      if (shownAt.current !== null) return;
      const showTimer = window.setTimeout(() => {
        shownAt.current = Date.now();
        setIsShown(true);
      }, SHOW_AFTER_MILLISECONDS);
      return () => window.clearTimeout(showTimer);
    }
    if (shownAt.current === null) return;
    const remaining = Math.max(
      0,
      SHOW_AT_LEAST_MILLISECONDS - (Date.now() - shownAt.current),
    );
    const hideTimer = window.setTimeout(() => {
      shownAt.current = null;
      setIsShown(false);
    }, remaining);
    return () => window.clearTimeout(hideTimer);
  }, [isRefreshing]);

  return isShown;
}
