/** Server IANA zone, fixed for this process; user/browser zones do not apply. */
export const LOG_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Returns the server-local calendar date of an event's capture time. */
export function logDate(instant: Date): string {
  const year = instant.getFullYear();
  const month = String(instant.getMonth() + 1).padStart(2, "0");
  const day = String(instant.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Returns the inclusive oldest retained calendar date, including DST days. */
export function oldestLogDate(today: Date, days: number): string {
  const cutoff = new Date(today);
  cutoff.setHours(12, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  return logDate(cutoff);
}

/** Recognizes only canonical, real calendar dates in Pages daily filenames. */
export function dailyLogDate(name: string): string | null {
  const match = /^pages-(\d{4}-\d{2}-\d{2})\.jsonl$/u.exec(name);
  const date = match?.[1];
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}
