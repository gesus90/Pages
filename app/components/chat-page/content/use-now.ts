import { useEffect, useState } from "react";

/** How often the remaining time of a file is updated. */
const NOW_INTERVAL_MILLISECONDS = 60 * 1000;

/**
 * The current moment for the remaining time of files (PAGE-382), updated
 * every minute.
 *
 * @returns Milliseconds since the epoch; `null` during the server render and
 * the first browser render, so both render the same.
 */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(
      () => setNow(Date.now()),
      NOW_INTERVAL_MILLISECONDS,
    );
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
