import { useEffect, useState } from "react";

const TICK_MS = 30_000;

/**
 * The clock relative times are measured against.
 *
 * @param readAt - The server time the page data was read at.
 *
 * @remarks
 * It starts at the server's reading time, so the server and the hydrating
 * browser render the same "in 6 Min.", and then follows the browser clock
 * every half minute.
 */
export function useNow(readAt: string): Date {
  const [now, setNow] = useState(() => new Date(readAt));
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [readAt]);
  return now;
}
