import { useTranslation } from "react-i18next";

import { dateToUtc } from "./calendar-dates";
import { wallDateOf } from "./calendar-layout";

import type { CalendarViewEntry, CalendarWeekday } from "@/definition/Calendar";

/** Formats dates and times of the calendar in the account's zone and language. */
export interface CalendarFormatter {
  readonly language: string;
  /** The time of day of an instant, such as `09:00`. */
  readonly time: (instant: string) => string;
  /** The time of an entry, such as `09:00–10:00`, or "ganztägig". */
  readonly timeRange: (entry: CalendarViewEntry) => string;
  /** The label of an hour of the grid. */
  readonly hour: (hour: number) => string;
  /** A short weekday, such as `Mo`. */
  readonly weekdayShort: (date: string) => string;
  /** A long weekday of a rule, such as `Donnerstag`. */
  readonly weekdayName: (weekday: CalendarWeekday) => string;
  /** Month and year, such as `November 2026`. */
  readonly monthTitle: (date: string) => string;
  /** Weekday, day and month, such as `Donnerstag, 12. November`. */
  readonly longDate: (date: string) => string;
  /** Day and month, such as `12. November`. */
  readonly dayMonth: (date: string) => string;
  /** A numeric date, such as `31.03.2027`. */
  readonly shortDate: (date: string) => string;
}

const WEEKDAY_ORDER: readonly CalendarWeekday[] = [
  "mo",
  "tu",
  "we",
  "th",
  "fr",
  "sa",
  "su",
];
/** 1 January 2024 is a Monday. */
const MONDAY_UTC = Date.UTC(2024, 0, 1, 12);
const DAY_MS = 86_400_000;
const HALF_DAY_MS = 43_200_000;

function dateFormatter(
  language: string,
  options: Intl.DateTimeFormatOptions,
): (date: string) => string {
  const format = new Intl.DateTimeFormat(language, {
    ...options,
    timeZone: "UTC",
  });
  return (date) => format.format(dateToUtc(date) + HALF_DAY_MS);
}

function withoutTrailingDot(text: string): string {
  return text.replace(/\.$/u, "");
}

/**
 * Builds the formatter of the calendar.
 *
 * @param language - The language of the interface, such as `de`.
 * @param timeZone - The account's zone all instants are shown in.
 * @param allDayLabel - The text of an all-day entry.
 */
export function createCalendarFormatter(
  language: string,
  timeZone: string,
  allDayLabel: string,
): CalendarFormatter {
  const clock = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const hourFormat = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const weekdayLong = new Intl.DateTimeFormat(language, {
    weekday: "long",
    timeZone: "UTC",
  });
  const shortDate = dateFormatter(language, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const weekdayShort = dateFormatter(language, { weekday: "short" });
  function time(instant: string): string {
    return clock.format(new Date(instant));
  }
  function timeRange(entry: CalendarViewEntry): string {
    if (!entry.allDay) return `${time(entry.start)}–${time(entry.end)}`;
    const first = wallDateOf(entry.start);
    const last = wallDateOf(entry.end);
    return first === last
      ? allDayLabel
      : `${shortDate(first)}–${shortDate(last)}`;
  }
  return {
    language,
    time,
    timeRange,
    hour: (hour) => hourFormat.format(Date.UTC(2024, 0, 1, hour)),
    weekdayShort: (date) => withoutTrailingDot(weekdayShort(date)),
    weekdayName: (weekday) =>
      weekdayLong.format(MONDAY_UTC + WEEKDAY_ORDER.indexOf(weekday) * DAY_MS),
    monthTitle: dateFormatter(language, { month: "long", year: "numeric" }),
    longDate: dateFormatter(language, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
    dayMonth: dateFormatter(language, { day: "numeric", month: "long" }),
    shortDate,
  };
}

/**
 * The formatter of the calendar in the language of the interface.
 *
 * @param timeZone - The account's zone from the page data.
 */
export function useCalendarFormatter(timeZone: string): CalendarFormatter {
  const { t, i18n } = useTranslation();
  return createCalendarFormatter(i18n.language, timeZone, t("calendar.allDay"));
}
