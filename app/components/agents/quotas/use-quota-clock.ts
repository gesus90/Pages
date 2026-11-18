import { useEffect, useState } from "react";

const TICK_MILLISECONDS = 1_000;

/**
 * The clock of the quota page, read every second.
 * @returns The current moment.
 * @remarks
 * A window leaves its card the moment its reset passes, and the countdown
 * to the reset counts minutes, so the page follows the clock closely.
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
