import { useEffect, useState } from "react";

/** How often the shown rest time is renewed. */
const TICK_MS = 1000;

/** The rest time of an open code, counted down on the client. */
export interface PairingCountdown {
  readonly remainingMs: number;
  readonly hasExpired: boolean;
  /** The rest time as `m:ss`. */
  readonly text: string;
}

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${Math.floor(totalSeconds / 60)}:${seconds}`;
}

/**
 * Counts down the rest time of an open code.
 *
 * @param initialRemainingMs - Rest time the server reported with its answer.
 * @returns The rest time, whether it ran out, and its text.
 *
 * @remarks
 * The server reports a duration, not a point in time, so a wrong clock of the
 * visitor's device cannot make a valid code look expired. The deadline is
 * fixed when the component appears; a new code appears as a new component.
 */
export function usePairingCountdown(
  initialRemainingMs: number,
): PairingCountdown {
  const [deadline] = useState(() => Date.now() + initialRemainingMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const remainingMs = Math.max(0, deadline - now);

  return {
    remainingMs,
    hasExpired: remainingMs <= 0,
    text: formatRemaining(remainingMs),
  };
}
