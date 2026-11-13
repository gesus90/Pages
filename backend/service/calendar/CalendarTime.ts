/** A wall-clock date and time without a zone. */
export interface LocalDateTime {
  readonly date: string;
  /** `HH:mm:ss`. */
  readonly time: string;
}

const DAY_MILLISECONDS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/**
 * Tells whether a value is a date `YYYY-MM-DD`.
 *
 * @param value - Any text.
 */
export function isCalendarDate(value: string): boolean {
  return DATE_PATTERN.test(value);
}

/**
 * Tells whether a name is a time zone the runtime knows.
 *
 * @param timeZone - An IANA name such as `Europe/Berlin`.
 */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatterOf(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The time zone of the server, the fallback of accounts without a setting. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Reads the wall-clock date and time of an instant in a zone.
 *
 * @param instant - Milliseconds since the epoch.
 * @param timeZone - IANA name.
 */
export function toLocal(instant: number, timeZone: string): LocalDateTime {
  const parts = formatterOf(timeZone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "00";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}:${part("second")}`,
  };
}

/**
 * Returns the offset of a zone at an instant in minutes east of UTC.
 *
 * @param instant - Milliseconds since the epoch.
 * @param timeZone - IANA name.
 */
export function offsetMinutes(instant: number, timeZone: string): number {
  const local = toLocal(instant, timeZone);
  const asUtc = Date.parse(`${local.date}T${local.time}Z`);
  const whole = Math.floor(instant / 1000) * 1000;
  return Math.round((asUtc - whole) / 60_000);
}

/**
 * Converts a wall-clock date and time of a zone to an instant.
 *
 * @param local - The wall clock.
 * @param timeZone - IANA name.
 * @returns Milliseconds since the epoch; a time in a gap of a change to
 * summer time moves forward by the gap.
 */
export function fromLocal(local: LocalDateTime, timeZone: string): number {
  const asUtc = Date.parse(`${local.date}T${local.time}Z`);
  const first = asUtc - offsetMinutes(asUtc, timeZone) * 60_000;
  const second = asUtc - offsetMinutes(first, timeZone) * 60_000;
  return second;
}

/**
 * Formats an instant as ISO-8601 with the offset of a zone, such as
 * `2026-11-12T14:00:00+01:00`.
 *
 * @param instant - Milliseconds since the epoch.
 * @param timeZone - IANA name.
 */
export function formatInZone(instant: number, timeZone: string): string {
  const local = toLocal(instant, timeZone);
  const offset = offsetMinutes(instant, timeZone);
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(offset);
  return `${local.date}T${local.time}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/**
 * Adds days to a date.
 *
 * @param date - `YYYY-MM-DD`.
 * @param days - Days to add; negative goes back.
 */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Counts the days from one date to another.
 *
 * @param from - `YYYY-MM-DD`.
 * @param to - `YYYY-MM-DD`.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      DAY_MILLISECONDS,
  );
}

/**
 * Returns the weekday of a date, 0 for Monday to 6 for Sunday.
 *
 * @param date - `YYYY-MM-DD`.
 */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Builds a date from its parts when it exists.
 *
 * @param year - Full year.
 * @param month - 1 to 12; months beyond roll into the next years.
 * @param day - Day of the month.
 * @returns The date, or `null` when the month has no such day.
 */
export function dateOf(year: number, month: number, day: number): string | null {
  const normalizedYear = year + Math.floor((month - 1) / 12);
  const normalizedMonth = ((((month - 1) % 12) + 12) % 12) + 1;
  const date = new Date(Date.UTC(normalizedYear, normalizedMonth - 1, day));
  if (date.getUTCMonth() !== normalizedMonth - 1) return null;
  return `${pad(date.getUTCFullYear(), 4)}-${pad(normalizedMonth)}-${pad(day)}`;
}

/**
 * Reads a time of a client as an instant.
 *
 * @param value - ISO-8601 with offset or `Z`, or a date that is read as the
 * start of that day in the zone.
 * @param timeZone - Zone of a date without time.
 */
export function parseInstant(value: string, timeZone: string): number {
  if (isCalendarDate(value))
    return fromLocal({ date: value, time: "00:00:00" }, timeZone);
  return Date.parse(value);
}

/**
 * Reads the date of a client time in a zone.
 *
 * @param value - A date, or an instant whose date in the zone counts.
 * @param timeZone - IANA name.
 */
export function dateIn(value: string, timeZone: string): string {
  if (isCalendarDate(value)) return value;
  return toLocal(Date.parse(value), timeZone).date;
}

/**
 * Formats an instant as stored UTC text.
 *
 * @param instant - Milliseconds since the epoch.
 */
export function toUtcText(instant: number): string {
  return new Date(instant).toISOString();
}
