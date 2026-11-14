import { useEffect, useState } from "react";

import { readZonedParts } from "@/app/components/automations/automation-zoned-time";

/** Now as a day and a minute of the account's zone. */
export interface CalendarNow {
  readonly date: string;
  readonly minute: number;
}

const MINUTE_MS = 60_000;

function pad(part: number): string {
  return String(part).padStart(2, "0");
}

function readNow(timeZone: string): CalendarNow {
  const parts = readZonedParts(new Date(), timeZone);
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    minute: parts.hour * 60 + parts.minute,
  };
}

/**
 * Follows the current time in the account's zone, once a minute.
 *
 * @remarks
 * `null` until the page runs in the browser, so the server and the first
 * browser rendering agree.
 *
 * @param timeZone - The account's zone.
 */
export function useCalendarNow(timeZone: string): CalendarNow | null {
  const [now, setNow] = useState<CalendarNow | null>(null);

  useEffect(() => {
    setNow(readNow(timeZone));
    const timer = window.setInterval(
      () => setNow(readNow(timeZone)),
      MINUTE_MS,
    );
    return () => window.clearInterval(timer);
  }, [timeZone]);

  return now;
}
