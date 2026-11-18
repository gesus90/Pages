const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type ClockKind = "second" | "minute" | "run";

const CLOCK_OPTIONS: Readonly<Record<ClockKind, Intl.DateTimeFormatOptions>> = {
  second: {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  },
  minute: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  run: {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  },
};

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** A formatter of the app language, kept once: building one per row would cost every redraw of the terminal. */
function clockFormatter(
  language: string,
  kind: ClockKind,
): Intl.DateTimeFormat {
  const key = `${language}/${kind}`;
  const known = clockFormatters.get(key);
  if (known) return known;
  const created = new Intl.DateTimeFormat(language, CLOCK_OPTIONS[kind]);
  clockFormatters.set(key, created);
  return created;
}

function readTime(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time;
}

/**
 * A time of day as `HH:MM:SS` on a 24-hour clock, in the local time zone.
 * @param at - Milliseconds since the epoch, or an ISO time.
 * @param language - The app language; the browser language never decides.
 * @returns The time, or `--:--:--` when it is missing or unreadable.
 */
export function formatSecondTime(
  at: string | number | null | undefined,
  language: string,
): string {
  const time = readTime(at);
  return time ? clockFormatter(language, "second").format(time) : "--:--:--";
}

/**
 * A time of day as `HH:MM` on a 24-hour clock, in the local time zone.
 * @param at - Milliseconds since the epoch, or an ISO time.
 * @param language - The app language; the browser language never decides.
 * @returns The time, or `--:--` when it is missing or unreadable.
 */
export function formatMinuteTime(
  at: string | number | null | undefined,
  language: string,
): string {
  const time = readTime(at);
  return time ? clockFormatter(language, "minute").format(time) : "--:--";
}

/**
 * The start of a run as date and time, such as `18.11.2026, 14:23` in German.
 * @param value - An ISO time as the server stores it.
 * @param language - The app language; the browser language never decides.
 * @returns Date and 24-hour time, or `null` for a missing or unreadable value.
 */
export function formatRunTime(
  value: string | null | undefined,
  language: string,
): string | null {
  const time = readTime(value);
  return time ? clockFormatter(language, "run").format(time) : null;
}

/**
 * A stored time in the local time zone of the reader, readable at a glance.
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
 * A running time as a clock, `mm:ss` and from one hour on `h:mm:ss`.
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
