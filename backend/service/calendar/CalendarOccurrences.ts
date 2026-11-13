import { listOccurrenceDates, spanDays } from "./CalendarRecurrence";
import {
  addDays,
  fromLocal,
  isCalendarDate,
  toLocal,
  toUtcText,
} from "./CalendarTime";

import type {
  CalendarEventRecord,
  CalendarExceptionRecord,
} from "@/backend/database/repositories/calendar/CalendarEventRepository";

/**
 * The time of one occurrence.
 *
 * @remarks
 * A timed occurrence has `startMs` and `endMs`; an all-day occurrence has
 * `startDate` and `endDate` (inclusive) and both instants `null`.
 */
export interface OccurrenceTime {
  readonly allDay: boolean;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly startDate: string;
  readonly endDate: string;
}

/** One occurrence of an event, after its exception was applied. */
export interface CalendarOccurrence extends OccurrenceTime {
  /** The original start in stored form; `null` for an event without rule. */
  readonly key: string | null;
  readonly title: string;
  readonly description: string;
}

/** A range in instants and in the dates of the viewer. */
export interface CalendarWindow {
  readonly fromMs: number;
  readonly toMs: number;
  readonly fromDate: string;
  readonly toDate: string;
}

/**
 * Reads the stored time of an event or an exception.
 *
 * @param fields - Stored start, end and whether the event is all-day.
 * @param timeZone - The zone of the event; dates of a timed event are read in it.
 */
export function readStoredTime(
  fields: { readonly allDay: boolean; readonly startAt: string; readonly endAt: string },
  timeZone: string,
): OccurrenceTime {
  if (fields.allDay) {
    const startDate = fields.startAt.slice(0, 10);
    const endDate = fields.endAt.slice(0, 10);
    return { allDay: true, startMs: null, endMs: null, startDate, endDate };
  }
  const startMs = isCalendarDate(fields.startAt)
    ? fromLocal({ date: fields.startAt, time: "00:00:00" }, timeZone)
    : Date.parse(fields.startAt);
  const endMs = isCalendarDate(fields.endAt)
    ? fromLocal({ date: fields.endAt, time: "00:00:00" }, timeZone)
    : Date.parse(fields.endAt);
  return {
    allDay: false,
    startMs,
    endMs,
    startDate: toLocal(startMs, timeZone).date,
    endDate: toLocal(endMs, timeZone).date,
  };
}

/**
 * Computes the key of the occurrence of a series on a date.
 *
 * @param event - The series.
 * @param date - An occurrence date in the zone of the series.
 * @returns The stored form of its original start.
 */
export function occurrenceKeyOn(event: CalendarEventRecord, date: string): string {
  if (event.allDay) return date;
  const base = readStoredTime(event, event.timeZone);
  const time = toLocal(base.startMs ?? 0, event.timeZone).time;
  return toUtcText(fromLocal({ date, time }, event.timeZone));
}

/**
 * Reads the date in the zone of a series of one of its occurrence keys.
 *
 * @param event - The series.
 * @param key - A key of {@link occurrenceKeyOn}.
 */
export function occurrenceDateOf(event: CalendarEventRecord, key: string): string {
  if (isCalendarDate(key)) return key;
  return toLocal(Date.parse(key), event.timeZone).date;
}

/**
 * Turns a time a client named for an occurrence into its stored key.
 *
 * @param event - The series.
 * @param value - A date, or an instant with offset.
 */
export function normalizeOccurrenceKey(
  event: CalendarEventRecord,
  value: string,
): string {
  if (event.allDay) return value.slice(0, 10);
  if (isCalendarDate(value)) return occurrenceKeyOn(event, value);
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? value : toUtcText(instant);
}

function occurrenceAt(
  event: CalendarEventRecord,
  date: string,
): OccurrenceTime & { readonly key: string } {
  const base = readStoredTime(event, event.timeZone);
  if (event.allDay) {
    return {
      key: date,
      allDay: true,
      startMs: null,
      endMs: null,
      startDate: date,
      endDate: addDays(date, spanDays(base.startDate, base.endDate)),
    };
  }
  const time = toLocal(base.startMs ?? 0, event.timeZone).time;
  const startMs = fromLocal({ date, time }, event.timeZone);
  const endMs = startMs + ((base.endMs ?? 0) - (base.startMs ?? 0));
  return {
    key: toUtcText(startMs),
    allDay: false,
    startMs,
    endMs,
    startDate: date,
    endDate: toLocal(endMs, event.timeZone).date,
  };
}

function applyException(
  event: CalendarEventRecord,
  occurrence: OccurrenceTime & { readonly key: string },
  exception: CalendarExceptionRecord | undefined,
): CalendarOccurrence | null {
  if (exception?.isCancelled) return null;
  const time =
    exception !== undefined &&
    exception.startAt !== null &&
    exception.endAt !== null &&
    exception.allDay !== null
      ? readStoredTime(
          {
            allDay: exception.allDay,
            startAt: exception.startAt,
            endAt: exception.endAt,
          },
          event.timeZone,
        )
      : occurrence;
  return {
    ...time,
    key: occurrence.key,
    title: exception?.title ?? event.title,
    description: exception?.description ?? event.description,
  };
}

/**
 * Tells whether an occurrence touches a window.
 *
 * @param time - The occurrence.
 * @param window - Instants and dates of the viewer.
 */
export function touchesWindow(time: OccurrenceTime, window: CalendarWindow): boolean {
  if (time.allDay)
    return time.startDate <= window.toDate && time.endDate >= window.fromDate;
  const startMs = time.startMs ?? 0;
  const endMs = Math.max(time.endMs ?? 0, startMs + 1);
  return startMs < window.toMs && endMs > window.fromMs;
}

/**
 * Lists the occurrences of an event that touch a window.
 *
 * @param event - The stored event or series.
 * @param exceptions - Its exceptions.
 * @param window - The range of the viewer.
 * @returns The occurrences in order; a cancelled occurrence is left out and a
 * changed one carries its own values.
 *
 * @remarks
 * The rule is computed in the zone of the series, so an event at 09:00 stays
 * at 09:00 local time after a change to or from summer time.
 */
export function expandOccurrences(
  event: CalendarEventRecord,
  exceptions: readonly CalendarExceptionRecord[],
  window: CalendarWindow,
): CalendarOccurrence[] {
  const base = readStoredTime(event, event.timeZone);
  if (event.recurrence === null) {
    const single: CalendarOccurrence = {
      ...base,
      key: null,
      title: event.title,
      description: event.description,
    };
    return touchesWindow(single, window) ? [single] : [];
  }
  const byKey = new Map(exceptions.map((entry) => [entry.occurrenceStart, entry]));
  const span = spanDays(base.startDate, base.endDate);
  const dates = listOccurrenceDates(
    event.recurrence,
    base.startDate,
    addDays(window.toDate, 1),
  ).filter((entry) => entry.date >= addDays(window.fromDate, -span - 2));
  const occurrences: CalendarOccurrence[] = [];
  for (const { date } of dates) {
    const plain = occurrenceAt(event, date);
    const occurrence = applyException(event, plain, byKey.get(plain.key));
    if (occurrence && touchesWindow(occurrence, window))
      occurrences.push(occurrence);
  }
  return occurrences;
}

/**
 * Returns the occurrence of a series with a given key, exception applied.
 *
 * @param event - The series.
 * @param exceptions - Its exceptions.
 * @param key - The stored key of the occurrence.
 * @returns The occurrence, or `null` when the key is no occurrence of the
 * series or the occurrence is cancelled.
 */
export function findOccurrence(
  event: CalendarEventRecord,
  exceptions: readonly CalendarExceptionRecord[],
  key: string,
): CalendarOccurrence | null {
  if (event.recurrence === null) return null;
  const date = occurrenceDateOf(event, key);
  const base = readStoredTime(event, event.timeZone);
  const isListed = listOccurrenceDates(event.recurrence, base.startDate, date).some(
    (entry) => entry.date === date,
  );
  if (!isListed) return null;
  const plain = occurrenceAt(event, date);
  if (plain.key !== key) return null;
  return applyException(
    event,
    plain,
    exceptions.find((entry) => entry.occurrenceStart === key),
  );
}
