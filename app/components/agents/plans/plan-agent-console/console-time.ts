const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * A stored time in the local time zone of the reader, readable at a glance.
 *
 * @param value - An ISO time as the server stores it.
 * @returns Date and time, or `null` for a missing or unreadable value.
 */
export function formatLocalTime(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : DATE_TIME.format(time);
}

/**
 * How long something ran, such as `1 h 4 min` or `42 s`.
 *
 * @param milliseconds - The duration.
 */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds % 60} s`;
  return `${seconds} s`;
}

/**
 * A running time as a clock, `mm:ss` and from one hour on `h:mm:ss` (PAGE-289).
 *
 * @param milliseconds - The duration.
 */
export function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}
