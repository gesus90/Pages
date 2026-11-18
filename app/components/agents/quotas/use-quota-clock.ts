import { useEffect, useState } from "react";

const TICK_MILLISECONDS = 1_000;

/**
 * The clock of the quota page, read every second.
 * @returns The current moment.
 * @remarks
 * "aktualisiert vor 12 Sek." counts seconds, and a window leaves its card the
 * moment its reset passes, so the page follows the clock closely.
 */
export function useQuotaClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(new Date()),
      TICK_MILLISECONDS,
    );
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
