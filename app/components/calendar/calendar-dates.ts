import { CALENDAR_LIMITS, CALENDAR_VIEWS } from "@/definition/Calendar";

import type { CalendarView, CalendarWeekday } from "@/definition/Calendar";

/** The days a calendar view shows, both dates `YYYY-MM-DD` inclusive. */
export interface CalendarDayRange {
  readonly from: string;
  readonly to: string;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 86_400_000;
const WEEKDAY_KEYS: readonly CalendarWeekday[] = [
  "mo",
  "tu",
  "we",
  "th",
  "fr",
  "sa",
  "su",
];

/** The days of a month grid: six weeks of seven days. */
export const MONTH_GRID_DAYS = 42;

function pad(part: number): string {
  return String(part).padStart(2, "0");
}

function fromUtc(milliseconds: number): string {
  const date = new Date(milliseconds);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Tells whether text is an existing date `YYYY-MM-DD`.
 *
 * @param text - Text of an address or a field.
 */
export function isCalendarDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  return (
    fromUtc(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    ) === text
  );
}

/**
 * Reads a date `YYYY-MM-DD` as milliseconds of its UTC midnight.
 *
 * @param date - A valid date.
 */
export function dateToUtc(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

/**
 * Moves a date by whole days.
 *
 * @param date - A valid date.
 * @param days - Days forward, or backward when negative.
 */
export function addDays(date: string, days: number): string {
  return fromUtc(dateToUtc(date) + days * DAY_MS);
}

/**
 * Moves a date by whole months to the first day of the target month.
 *
 * @param date - A valid date.
 * @param months - Months forward, or backward when negative.
 */
export function addMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  return fromUtc(Date.UTC(year, month, 1));
}

/**
 * Counts the days from one date to another.
 *
 * @param from - The earlier date.
 * @param to - The later date.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateToUtc(to) - dateToUtc(from)) / DAY_MS);
}

/**
 * The ISO weekday of a date, 1 Monday to 7 Sunday.
 *
 * @param date - A valid date.
 */
export function isoWeekday(date: string): number {
  const weekday = new Date(dateToUtc(date)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/**
 * The weekday key of a date as recurrence rules name it.
 *
 * @param date - A valid date.
 */
export function weekdayKeyOf(date: string): CalendarWeekday {
  return WEEKDAY_KEYS[isoWeekday(date) - 1] ?? "mo";
}

/**
 * The Monday of the week of a date.
 *
 * @param date - A valid date.
 */
export function startOfWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * The ISO 8601 week number of a date.
 *
 * @param date - A valid date.
 */
export function isoWeekNumber(date: string): number {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(daysBetween(yearStart, thursday) / 7) + 1;
}

/**
 * The seven dates of the week of a date, Monday first.
 *
 * @param date - A valid date.
 */
export function weekDates(date: string): string[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/**
 * The 42 dates of the month grid of a date: six weeks from the Monday on
 * or before the first of the month.
 *
 * @param date - Any date of the month.
 */
export function monthGridDates(date: string): string[] {
  const first = startOfWeek(`${date.slice(0, 7)}-01`);
  return Array.from({ length: MONTH_GRID_DAYS }, (_, index) =>
    addDays(first, index),
  );
}

/**
 * The days a view shows around its anchor date.
 *
 * @param view - Day, week, month or list.
 * @param date - The anchor date of the view.
 */
export function visibleRange(
  view: CalendarView,
  date: string,
): CalendarDayRange {
  switch (view) {
    case "day":
      return { from: date, to: date };
    case "week": {
      const monday = startOfWeek(date);
      return { from: monday, to: addDays(monday, 6) };
    }
    case "month": {
      const days = monthGridDates(date);
      return { from: days[0] ?? date, to: days[days.length - 1] ?? date };
    }
    case "list":
      return { from: date, to: addDays(date, CALENDAR_LIMITS.listDays - 1) };
  }
}

/**
 * The anchor date one step before or after in a view.
 *
 * @param view - Day, week, month or list.
 * @param date - The current anchor date.
 * @param direction - `1` forward, `-1` back.
 */
export function shiftAnchor(
  view: CalendarView,
  date: string,
  direction: 1 | -1,
): string {
  switch (view) {
    case "day":
      return addDays(date, direction);
    case "week":
      return addDays(date, 7 * direction);
    case "month":
      return addMonths(date, direction);
    case "list":
      return addDays(date, CALENDAR_LIMITS.listDays * direction);
  }
}

/**
 * Reads a view name of an address.
 *
 * @param text - The `view` parameter.
 * @returns The view, or `null` for a missing or unknown one.
 */
export function readCalendarView(text: string | null): CalendarView | null {
  return CALENDAR_VIEWS.find((view) => view === text) ?? null;
}
