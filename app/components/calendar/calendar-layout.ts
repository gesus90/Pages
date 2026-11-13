import { addDays } from "./calendar-dates";

import type { CalendarViewEntry } from "@/definition/Calendar";

/** A timed entry placed in the column of one day. */
export interface PlacedEntry {
  readonly entry: CalendarViewEntry;
  /** Minutes after midnight of the day where the block starts, 0–1440. */
  readonly startMinute: number;
  /** Minutes after midnight of the day where the block ends, 0–1440. */
  readonly endMinute: number;
  /** Zero-based column within its group of overlapping entries. */
  readonly column: number;
  /** Columns of its group of overlapping entries. */
  readonly columns: number;
}

interface DaySlice {
  readonly entry: CalendarViewEntry;
  readonly startMinute: number;
  readonly endMinute: number;
}

const MINUTES_PER_DAY = 1440;
/** Short entries keep a readable height. */
const MINIMUM_BLOCK_MINUTES = 20;

/**
 * The wall-clock time `YYYY-MM-DDTHH:MM` of an entry time.
 *
 * @remarks
 * The server sends times with the offset of the viewer's zone, so the local
 * date and time stand in the text itself; a date alone is its midnight.
 *
 * @param time - Start or end of an entry.
 */
export function wallClockOf(time: string): string {
  return time.length <= 10 ? `${time}T00:00` : time.slice(0, 16);
}

/**
 * The local date `YYYY-MM-DD` of an entry time.
 *
 * @param time - Start or end of an entry.
 */
export function wallDateOf(time: string): string {
  return time.slice(0, 10);
}

function minutesOf(wallClock: string): number {
  return Number(wallClock.slice(11, 13)) * 60 + Number(wallClock.slice(14, 16));
}

/**
 * Tells whether an entry falls on a day.
 *
 * @param entry - An all-day or timed entry.
 * @param date - The day.
 */
export function isEntryOnDay(entry: CalendarViewEntry, date: string): boolean {
  if (entry.allDay)
    return wallDateOf(entry.start) <= date && wallDateOf(entry.end) >= date;
  const dayStart = `${date}T00:00`;
  const dayEnd = `${addDays(date, 1)}T00:00`;
  const start = wallClockOf(entry.start);
  const end = wallClockOf(entry.end);
  if (start === end) return start >= dayStart && start < dayEnd;
  return start < dayEnd && end > dayStart;
}

function sliceOf(entry: CalendarViewEntry, date: string): DaySlice {
  const start = wallClockOf(entry.start);
  const end = wallClockOf(entry.end);
  const startMinute = wallDateOf(start) < date ? 0 : minutesOf(start);
  const endMinute = wallDateOf(end) > date ? MINUTES_PER_DAY : minutesOf(end);
  return {
    entry,
    startMinute,
    endMinute: Math.min(
      MINUTES_PER_DAY,
      Math.max(endMinute, startMinute + MINIMUM_BLOCK_MINUTES),
    ),
  };
}

function compareSlices(left: DaySlice, right: DaySlice): number {
  return (
    left.startMinute - right.startMinute ||
    right.endMinute - left.endMinute ||
    left.entry.title.localeCompare(right.entry.title)
  );
}

/** Places one group of transitively overlapping slices in columns. */
function placeGroup(group: readonly DaySlice[]): PlacedEntry[] {
  const columnEnds: number[] = [];
  const columnOf = group.map((slice) => {
    const free = columnEnds.findIndex((end) => end <= slice.startMinute);
    const column = free === -1 ? columnEnds.length : free;
    columnEnds[column] = slice.endMinute;
    return column;
  });
  return group.map((slice, index) => ({
    ...slice,
    column: columnOf[index] ?? 0,
    columns: columnEnds.length,
  }));
}

/**
 * Lays out the timed entries of one day side by side where they overlap.
 *
 * @remarks
 * Entries are sorted by start (longer first); a group collects entries as
 * long as one of them still runs, and each entry takes the leftmost column
 * that is free at its start. All entries of a group share its column count.
 *
 * @param entries - Entries of the visible range; all-day entries are skipped.
 * @param date - The day of the column.
 * @returns The blocks of the day with their minutes and columns.
 */
export function layoutDay(
  entries: readonly CalendarViewEntry[],
  date: string,
): PlacedEntry[] {
  const slices = entries
    .filter((entry) => !entry.allDay && isEntryOnDay(entry, date))
    .map((entry) => sliceOf(entry, date))
    .sort(compareSlices);
  const placed: PlacedEntry[] = [];
  let group: DaySlice[] = [];
  let groupEnd = -1;
  for (const slice of slices) {
    if (group.length > 0 && slice.startMinute >= groupEnd) {
      placed.push(...placeGroup(group));
      group = [];
    }
    group.push(slice);
    groupEnd = Math.max(group.length === 1 ? 0 : groupEnd, slice.endMinute);
  }
  if (group.length > 0) placed.push(...placeGroup(group));
  return placed;
}

/**
 * The entries of one day in reading order: all-day entries first, then by start.
 *
 * @param entries - Entries of the visible range.
 * @param date - The day.
 */
export function entriesOfDay(
  entries: readonly CalendarViewEntry[],
  date: string,
): CalendarViewEntry[] {
  return entries
    .filter((entry) => isEntryOnDay(entry, date))
    .sort((left, right) => {
      if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
      return (
        wallClockOf(left.start).localeCompare(wallClockOf(right.start)) ||
        left.title.localeCompare(right.title)
      );
    });
}

/**
 * The minute the time grid of a day scrolls to first: the start of the
 * earliest timed entry, or 08:00 without one.
 *
 * @param entries - Entries of the visible range.
 * @param dates - The days the grid shows.
 */
export function firstScrollMinute(
  entries: readonly CalendarViewEntry[],
  dates: readonly string[],
): number {
  const starts = dates.flatMap((date) =>
    layoutDay(entries, date).map((placed) => placed.startMinute),
  );
  return starts.length === 0 ? 8 * 60 : Math.min(...starts);
}
