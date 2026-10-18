import type { UserDateFormat } from "@/definition/Settings";

/** How dates and times are shown to one visitor. */
export interface RegionFormat {
  /** IANA time zone the instants are shown in. */
  readonly timeZone: string;
  readonly dateFormat: UserDateFormat;
}

interface DateParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
}

interface DateTimeParts extends DateParts {
  readonly hour: string;
  readonly minute: string;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/u;

const DATE_COMPOSERS: Readonly<
  Record<UserDateFormat, (parts: DateParts) => string>
> = {
  "DD.MM.YYYY": ({ day, month, year }) => `${day}.${month}.${year}`,
  "MM/DD/YYYY": ({ day, month, year }) => `${month}/${day}/${year}`,
  "YYYY-MM-DD": ({ day, month, year }) => `${year}-${month}-${day}`,
};

/**
 * Reads a stored timestamp as an instant.
 *
 * @param value - Database text such as `2026-09-30 14:05:00` (UTC) or an ISO
 * timestamp.
 * @returns The instant, or `null` for a calendar date or unreadable text.
 */
export function parseInstant(value: string): Date | null {
  if (CALENDAR_DATE.test(value)) {
    return null;
  }

  const isoText = value.replace(" ", "T");
  const date = new Date(EXPLICIT_ZONE.test(isoText) ? isoText : `${isoText}Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readZonedParts(date: Date, timeZone: string): DateTimeParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
    // Every field requested above is part of the result.
  ) as Record<Intl.DateTimeFormatPartTypes, string>;

  return {
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    month: parts.month,
    year: parts.year,
  };
}

/**
 * Formats a stored date or timestamp as a date.
 *
 * @param value - Calendar date such as `2026-09-30`, a timestamp, or `null`.
 * @param region - Time zone and date format of the visitor.
 * @returns The date in the visitor's format, `---` without a value, or the
 * raw value when it cannot be read.
 *
 * @remarks
 * A calendar date has no time of day, so no time zone applies to it; only a
 * timestamp moves to the visitor's time zone first.
 */
export function formatDate(value: string | null, region: RegionFormat): string {
  if (!value) {
    return "---";
  }

  const calendarDate = CALENDAR_DATE.exec(value);

  if (calendarDate) {
    const [, year = "", month = "", day = ""] = calendarDate;

    return DATE_COMPOSERS[region.dateFormat]({ day, month, year });
  }

  const instant = parseInstant(value);

  return instant === null
    ? value
    : DATE_COMPOSERS[region.dateFormat](
        readZonedParts(instant, region.timeZone),
      );
}

/**
 * Formats a stored timestamp as a date with the time of day.
 *
 * @param value - Timestamp, a calendar date, or `null`.
 * @param region - Time zone and date format of the visitor.
 * @returns The date and the time such as `30.09.2026 16:05`; a calendar date
 * stays a date, since it has no time of day.
 */
export function formatDateTime(
  value: string | null,
  region: RegionFormat,
): string {
  const instant = value ? parseInstant(value) : null;

  if (instant === null) {
    return formatDate(value, region);
  }

  const { hour, minute, ...date } = readZonedParts(instant, region.timeZone);

  return `${DATE_COMPOSERS[region.dateFormat](date)} ${hour}:${minute}`;
}

/**
 * Formats the time of day of a stored timestamp.
 *
 * @param value - Timestamp such as `2026-09-30 14:05:00` (UTC).
 * @param region - Time zone and date format of the visitor.
 * @returns The time such as `16:05`, or `null` for a calendar date or
 * unreadable text.
 */
export function formatTimeOfDay(
  value: string,
  region: RegionFormat,
): string | null {
  const instant = parseInstant(value);

  if (instant === null) {
    return null;
  }

  const { hour, minute } = readZonedParts(instant, region.timeZone);

  return `${hour}:${minute}`;
}

function readZonedDayNumber(date: Date, timeZone: string): number {
  const { year, month, day } = readZonedParts(date, timeZone);

  return Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000;
}

/**
 * Counts the calendar days from a stored timestamp to a moment.
 *
 * @param value - Timestamp such as `2026-09-30 14:05:00` (UTC).
 * @param now - The moment to count to, usually the current time.
 * @param region - Time zone and date format of the visitor.
 * @returns `0` on the same day and `1` on the day before, both in the
 * visitor's time zone; `null` for a calendar date or unreadable text.
 */
export function calendarDaysBefore(
  value: string,
  now: Date,
  region: RegionFormat,
): number | null {
  const instant = parseInstant(value);

  if (instant === null) {
    return null;
  }

  return (
    readZonedDayNumber(now, region.timeZone) -
    readZonedDayNumber(instant, region.timeZone)
  );
}
