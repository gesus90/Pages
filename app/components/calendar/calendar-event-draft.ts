import { zonedInputToIso } from "@/app/components/automations/automation-zoned-time";
import { CALENDAR_LIMITS } from "@/definition/Calendar";

import { addDays, isCalendarDate } from "./calendar-dates";
import { wallClockOf, wallDateOf } from "./calendar-layout";
import { recurrenceOf, repeatFieldsOf } from "./calendar-recurrence";

import type {
  CalendarInviteeReference,
  CalendarRecurrence,
  CalendarScope,
  CalendarViewEntry,
} from "@/definition/Calendar";
import type { CalendarDraftStart } from "./calendar-context";
import type { CalendarInviteeChoice } from "./calendar-page-data";
import type { RepeatFields } from "./calendar-recurrence";

/** The fields of the event form as the person edits them. */
export interface EventDraft {
  readonly title: string;
  readonly description: string;
  /** First day `YYYY-MM-DD`. */
  readonly date: string;
  /** Last day of an all-day event, `YYYY-MM-DD`. */
  readonly endDate: string;
  /** `HH:MM`. */
  readonly startTime: string;
  /** `HH:MM`; not after the start means the next day. */
  readonly endTime: string;
  readonly allDay: boolean;
  /** The project calendar, or `""` for „Meine Termine“. */
  readonly calendarProjectId: string;
  readonly invitees: readonly CalendarInviteeChoice[];
  readonly repeat: RepeatFields;
}

/** The fields of an event as the action expects them. */
export interface EventFields {
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly calendarProjectId: string | null;
  readonly invitees: readonly CalendarInviteeReference[];
  readonly recurrence: CalendarRecurrence | null;
}

/** Why the form cannot be sent, as keys under `calendar.form.errors`. */
export type EventDraftProblem =
  "title" | "date" | "time" | "endBeforeStart" | "until";

/** Either the fields to send or the first problem of the form. */
export type EventDraftResult =
  | { readonly ok: true; readonly fields: EventFields }
  | { readonly ok: false; readonly problem: EventDraftProblem };

const DEFAULT_START_MINUTE = 9 * 60;
const DEFAULT_DURATION_MINUTES = 60;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

function clockOf(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/**
 * The form of a new event, starting where the person clicked.
 *
 * @param start - The day and, from the grid, the minute.
 * @param calendarProjectId - The preselected calendar.
 */
export function draftForNew(
  start: CalendarDraftStart,
  calendarProjectId = "",
): EventDraft {
  const minute = start.minute ?? DEFAULT_START_MINUTE;
  return {
    title: "",
    description: "",
    date: start.date,
    endDate: start.date,
    startTime: clockOf(minute),
    endTime: clockOf(minute + DEFAULT_DURATION_MINUTES),
    allDay: false,
    calendarProjectId,
    invitees: [],
    repeat: repeatFieldsOf(null, start.date),
  };
}

/**
 * The form of an existing entry.
 *
 * @param entry - The entry to change.
 */
export function draftFromEntry(entry: CalendarViewEntry): EventDraft {
  const date = wallDateOf(entry.start);
  return {
    title: entry.title,
    description: entry.description,
    date,
    endDate: wallDateOf(entry.end),
    startTime: entry.allDay ? "09:00" : wallClockOf(entry.start).slice(11, 16),
    endTime: entry.allDay ? "10:00" : wallClockOf(entry.end).slice(11, 16),
    allDay: entry.allDay,
    calendarProjectId:
      entry.calendar.kind === "project" ? (entry.calendar.projectId ?? "") : "",
    invitees: entry.invitees.map(({ kind, id, name }) => ({ kind, id, name })),
    repeat: repeatFieldsOf(entry.recurrence, date),
  };
}

type TimesResult =
  | { readonly ok: true; readonly start: string; readonly end: string }
  | { readonly ok: false; readonly problem: EventDraftProblem };

function timesOf(draft: EventDraft, timeZone: string): TimesResult {
  if (!isCalendarDate(draft.date)) return { ok: false, problem: "date" };
  if (draft.allDay) {
    if (!isCalendarDate(draft.endDate)) return { ok: false, problem: "date" };
    if (draft.endDate < draft.date)
      return { ok: false, problem: "endBeforeStart" };
    return { ok: true, start: draft.date, end: draft.endDate };
  }
  if (!TIME_PATTERN.test(draft.startTime) || !TIME_PATTERN.test(draft.endTime))
    return { ok: false, problem: "time" };
  if (draft.startTime === draft.endTime)
    return { ok: false, problem: "endBeforeStart" };
  const endDay =
    draft.endTime < draft.startTime ? addDays(draft.date, 1) : draft.date;
  const start = zonedInputToIso(
    { date: draft.date, time: draft.startTime },
    timeZone,
  );
  const end = zonedInputToIso({ date: endDay, time: draft.endTime }, timeZone);
  if (start === null || end === null) return { ok: false, problem: "time" };
  return { ok: true, start, end };
}

/**
 * Checks the form and builds the fields of the event.
 *
 * @param draft - The form.
 * @param timeZone - The account's zone the date and times are meant in.
 */
export function fieldsOfDraft(
  draft: EventDraft,
  timeZone: string,
): EventDraftResult {
  const title = draft.title.trim();
  if (title === "" || title.length > CALENDAR_LIMITS.titleCharacters)
    return { ok: false, problem: "title" };
  const times = timesOf(draft, timeZone);
  if (!times.ok) return times;
  const recurrence = recurrenceOf(draft.repeat, draft.date);
  if (
    recurrence !== null &&
    recurrence.until !== null &&
    recurrence.until < draft.date
  )
    return { ok: false, problem: "until" };
  return {
    ok: true,
    fields: {
      title,
      description: draft.description.slice(
        0,
        CALENDAR_LIMITS.descriptionCharacters,
      ),
      start: times.start,
      end: times.end,
      allDay: draft.allDay,
      calendarProjectId:
        draft.calendarProjectId === "" ? null : draft.calendarProjectId,
      invitees: draft.invitees.map(({ kind, id }) => ({ kind, id })),
      recurrence,
    },
  };
}

function inviteeKeys(draft: EventDraft): string {
  return draft.invitees
    .map((invitee) => `${invitee.kind}:${invitee.id}`)
    .sort()
    .join(",");
}

function haveTimesChanged(draft: EventDraft, initial: EventDraft): boolean {
  if (draft.allDay !== initial.allDay || draft.date !== initial.date)
    return true;
  if (draft.allDay) return draft.endDate !== initial.endDate;
  return (
    draft.startTime !== initial.startTime || draft.endTime !== initial.endTime
  );
}

/**
 * The change of an existing event: only the fields the person changed.
 *
 * @remarks
 * A change of a single occurrence (`this`) never carries the rule.
 *
 * @param fields - The checked fields of the form.
 * @param draft - The form.
 * @param initial - The form as it opened.
 * @param scope - Which occurrences the change covers.
 */
export function patchOfDraft(
  fields: EventFields,
  draft: EventDraft,
  initial: EventDraft,
  scope: CalendarScope,
): Partial<EventFields> {
  const patch: Partial<EventFields> = {
    ...(fields.title !== initial.title.trim() && { title: fields.title }),
    ...(draft.description !== initial.description && {
      description: fields.description,
    }),
    ...(draft.calendarProjectId !== initial.calendarProjectId && {
      calendarProjectId: fields.calendarProjectId,
    }),
    ...(inviteeKeys(draft) !== inviteeKeys(initial) && {
      invitees: fields.invitees,
    }),
    ...(haveTimesChanged(draft, initial) && {
      start: fields.start,
      end: fields.end,
      allDay: fields.allDay,
    }),
  };
  const initialRule = JSON.stringify(
    recurrenceOf(initial.repeat, initial.date),
  );
  if (scope !== "this" && JSON.stringify(fields.recurrence) !== initialRule)
    return { ...patch, recurrence: fields.recurrence };
  return patch;
}
