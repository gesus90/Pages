import { useEffect, useState } from "react";

/**
 * Tells whether a wait has lasted for a given time.
 * @param isWaiting - Whether the thing waited for is still outstanding.
 * @param delayMs - How long a wait counts as quick, in milliseconds.
 * @returns `true` once `isWaiting` has stayed `true` for `delayMs`, and `false`
 * again as soon as the wait ends.
 * @remarks
 * An answer that comes within `delayMs` never turns it on, so a short wait
 * shows no progress at all.
 */
export function useHasWaited(isWaiting: boolean, delayMs: number): boolean {
  const [hasWaited, setHasWaited] = useState(false);

  useEffect(() => {
    if (!isWaiting) return undefined;

    const timer = setTimeout(() => setHasWaited(true), delayMs);

    return () => {
      clearTimeout(timer);
      setHasWaited(false);
    };
  }, [isWaiting, delayMs]);

  return isWaiting && hasWaited;
}
