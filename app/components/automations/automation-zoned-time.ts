/** The wall clock of an instant in one time zone. */
export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** ISO weekday, 1 Monday to 7 Sunday. */
  readonly weekday: number;
}

/** A date and a time of day as the inputs of the editor hold them. */
export interface ZonedInput {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `HH:MM`. */
  readonly time: string;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const DAY_MS = 86_400_000;

function pad(part: number): string {
  return String(part).padStart(2, "0");
}

function readNumber(parts: Intl.DateTimeFormatPart[], type: string): number {
  return Number(parts.find((part) => part.type === type)?.value ?? "0");
}

/**
 * Reads the wall clock of an instant in a time zone.
 *
 * @param instant - The moment to read.
 * @param timeZone - IANA time zone such as `Europe/Berlin`.
 */
export function readZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(instant);
  const year = readNumber(parts, "year");
  const month = readNumber(parts, "month");
  const day = readNumber(parts, "day");
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    year,
    month,
    day,
    hour: readNumber(parts, "hour"),
    minute: readNumber(parts, "minute"),
    second: readNumber(parts, "second"),
    weekday: weekday === 0 ? 7 : weekday,
  };
}

/**
 * Counts the calendar day of an instant in a time zone, for "today",
 * "tomorrow" and "yesterday".
 */
export function zonedDayNumber(instant: Date, timeZone: string): number {
  const { year, month, day } = readZonedParts(instant, timeZone);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** Formats the time of day of an instant in a time zone as `HH:MM`. */
export function formatZonedClock(instant: Date, timeZone: string): string {
  const { hour, minute } = readZonedParts(instant, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const wholeSeconds = Math.floor(instantMs / 1000) * 1000;
  const parts = readZonedParts(new Date(wholeSeconds), timeZone);
  const wallMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wallMs - wholeSeconds;
}

function formatOffset(offsetMs: number): string {
  const totalMinutes = Math.round(Math.abs(offsetMs) / 60_000);
  const sign = offsetMs < 0 ? "-" : "+";
  return `${sign}${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
}

/**
 * Turns a date and a time of day in a time zone into an ISO 8601 timestamp
 * with the offset that zone has at that moment.
 *
 * @param input - Date `YYYY-MM-DD` and time `HH:MM`.
 * @param timeZone - IANA time zone the date and time are meant in.
 * @returns The timestamp, or `null` for an unreadable date or time.
 *
 * @remarks
 * The offset is looked up twice: once for the wall clock read as UTC and
 * again for the instant found, which settles the hours around a daylight
 * saving change.
 */
export function zonedInputToIso(
  input: ZonedInput,
  timeZone: string,
): string | null {
  const dateMatch = DATE_PATTERN.exec(input.date);
  const timeMatch = TIME_PATTERN.exec(input.time);
  if (!dateMatch || !timeMatch) return null;
  const wallMs = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  if (Number.isNaN(wallMs)) return null;
  const firstOffset = zoneOffsetMs(wallMs, timeZone);
  const settledOffset = zoneOffsetMs(wallMs - firstOffset, timeZone);
  return `${input.date}T${input.time}:00${formatOffset(settledOffset)}`;
}

/**
 * Reads an ISO timestamp as the date and time of day of a time zone.
 *
 * @returns Empty fields for a missing or unreadable timestamp.
 */
export function isoToZonedInput(
  iso: string | null,
  timeZone: string,
): ZonedInput {
  const instant = iso ? new Date(iso) : null;
  if (!instant || Number.isNaN(instant.getTime()))
    return { date: "", time: "" };
  const parts = readZonedParts(instant, timeZone);
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

/**
 * The date of the day after an instant in a time zone, as `YYYY-MM-DD`;
 * the default date of a new once automation.
 */
export function zonedTomorrow(now: Date, timeZone: string): string {
  const { year, month, day } = readZonedParts(now, timeZone);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return `${tomorrow.getUTCFullYear()}-${pad(tomorrow.getUTCMonth() + 1)}-${pad(tomorrow.getUTCDate())}`;
}

/** Tells whether text is an `HH:MM` time of day. */
export function isClockTime(text: string): boolean {
  return TIME_PATTERN.test(text);
}
