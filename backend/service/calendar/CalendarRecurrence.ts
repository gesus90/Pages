import { CALENDAR_WEEKDAYS } from "@/definition/Calendar";

import { addDays, dateOf, daysBetween, weekdayIndex } from "./CalendarTime";

import type { CalendarRecurrence } from "@/definition/Calendar";

/** One occurrence date of a series with its position, 0 for the first. */
export interface OccurrenceDate {
  readonly index: number;
  readonly date: string;
}

/** Stops a rule that never ends from running forever in a single read. */
const MAXIMUM_STEPS = 100_000;

function weekdaysOf(rule: CalendarRecurrence, startDate: string): number[] {
  const indexes = rule.weekdays.map((day) => CALENDAR_WEEKDAYS.indexOf(day));
  const chosen = indexes.length === 0 ? [weekdayIndex(startDate)] : indexes;
  return [...new Set(chosen)].sort((left, right) => left - right);
}

function* dailyDates(
  rule: CalendarRecurrence,
  startDate: string,
): Generator<string> {
  for (let step = 0; ; step += 1) yield addDays(startDate, step * rule.interval);
}

function* weeklyDates(
  rule: CalendarRecurrence,
  startDate: string,
): Generator<string> {
  const weekStart = addDays(startDate, -weekdayIndex(startDate));
  const weekdays = weekdaysOf(rule, startDate);
  for (let step = 0; ; step += 1) {
    const base = addDays(weekStart, step * 7 * rule.interval);
    for (const weekday of weekdays) yield addDays(base, weekday);
  }
}

function* monthlyDates(
  rule: CalendarRecurrence,
  startDate: string,
): Generator<string> {
  const [year = 1970, month = 1, day = 1] = startDate.split("-").map(Number);
  const monthStep =
    rule.frequency === "monthly" ? rule.interval : rule.interval * 12;
  for (let step = 0; ; step += 1) {
    // A day the month does not have is skipped; the series keeps its day.
    yield dateOf(year, month + step * monthStep, day) ?? "";
  }
}

function candidateDates(
  rule: CalendarRecurrence,
  startDate: string,
): Generator<string> {
  if (rule.frequency === "daily") return dailyDates(rule, startDate);
  if (rule.frequency === "weekly") return weeklyDates(rule, startDate);
  return monthlyDates(rule, startDate);
}

/**
 * Lists the dates of a series in order, from its first date on.
 *
 * @param rule - The rule of the series.
 * @param startDate - The local date of the first occurrence in the zone of
 * the series.
 * @param until - The last date the caller needs; the listing stops after it.
 * @returns The occurrence dates up to `until`, the end of the rule or the
 * step limit, whichever comes first.
 *
 * @remarks
 * A monthly or yearly series on a day a month does not have (the 31st, the
 * 29th of February) has no occurrence in that month. `count` counts the
 * occurrences from the first one, cancelled ones included.
 */
export function listOccurrenceDates(
  rule: CalendarRecurrence,
  startDate: string,
  until: string,
): OccurrenceDate[] {
  const dates: OccurrenceDate[] = [];
  let index = 0;
  let steps = 0;
  for (const candidate of candidateDates(rule, startDate)) {
    steps += 1;
    if (steps > MAXIMUM_STEPS) break;
    if (candidate === "" || candidate < startDate) continue;
    if (candidate > until) break;
    if (rule.until !== null && candidate > rule.until) break;
    if (rule.count !== null && index >= rule.count) break;
    dates.push({ index, date: candidate });
    index += 1;
  }
  return dates;
}

/**
 * Tells the last date a series reaches, or `null` when it never ends.
 *
 * @param rule - The rule.
 * @param startDate - The first date.
 */
export function lastOccurrenceDate(
  rule: CalendarRecurrence,
  startDate: string,
): string | null {
  if (rule.until !== null) return rule.until;
  if (rule.count === null) return null;
  const far = addDays(startDate, 366 * 100);
  return listOccurrenceDates(rule, startDate, far).at(-1)?.date ?? startDate;
}

/**
 * Counts the occurrences of a series from a date on.
 *
 * @param rule - The rule.
 * @param startDate - The first date of the series.
 * @param fromDate - The first date that counts.
 * @returns The number, or `"unbegrenzt"` for a series without end.
 */
export function countOccurrencesFrom(
  rule: CalendarRecurrence,
  startDate: string,
  fromDate: string,
): number | "unbegrenzt" {
  const last = lastOccurrenceDate(rule, startDate);
  if (last === null) return "unbegrenzt";
  return listOccurrenceDates(rule, startDate, last).filter(
    (occurrence) => occurrence.date >= fromDate,
  ).length;
}

/**
 * Ends a series before one of its dates, for "this and all following".
 *
 * @param rule - The rule of the series.
 * @param startDate - The first date of the series.
 * @param splitDate - The first date that no longer belongs to the series.
 * @returns The shortened rule of the old series, or `null` when nothing is
 * left before the split, and the rule of the following part.
 */
export function splitRecurrence(
  rule: CalendarRecurrence,
  startDate: string,
  splitDate: string,
): { readonly before: CalendarRecurrence | null; readonly after: CalendarRecurrence } {
  const earlier = listOccurrenceDates(rule, startDate, addDays(splitDate, -1));
  const shortened: CalendarRecurrence =
    rule.count === null
      ? { ...rule, until: addDays(splitDate, -1) }
      : { ...rule, count: earlier.length };
  const before = earlier.length === 0 ? null : shortened;
  const after =
    rule.count === null
      ? rule
      : { ...rule, count: Math.max(1, rule.count - earlier.length) };
  return { before, after };
}

/**
 * Tells whether a date is an occurrence of a series.
 *
 * @param rule - The rule.
 * @param startDate - The first date of the series.
 * @param date - The date in question.
 */
export function isOccurrenceDate(
  rule: CalendarRecurrence,
  startDate: string,
  date: string,
): boolean {
  if (date < startDate) return false;
  return listOccurrenceDates(rule, startDate, date).some(
    (occurrence) => occurrence.date === date,
  );
}

/**
 * Counts the days an all-day or timed event covers beyond its first day.
 *
 * @param startDate - The first date.
 * @param endDate - The last date.
 */
export function spanDays(startDate: string, endDate: string): number {
  return Math.max(0, daysBetween(startDate, endDate));
}
