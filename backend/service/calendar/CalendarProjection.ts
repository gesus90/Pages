import { addDays, formatInZone, fromLocal } from "./CalendarTime";

import type { CalendarEventRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type {
  CalendarDueTicketRecord,
  CalendarMilestoneRecord,
  CalendarProjectDateRecord,
} from "@/backend/database/repositories/calendar/CalendarSourceRepository";
import type {
  CalendarOfEntry,
  CalendarViewEntry,
} from "@/definition/Calendar";
import type { Language } from "@/language/Language";
import type { CalendarOccurrence, OccurrenceTime } from "./CalendarOccurrences";
import type { CalendarParticipants } from "./CalendarPeople";
import type { CalendarViewer } from "./CalendarViewer";

/** Server texts of the calendar in the languages of Pages. */
const TEXTS: Readonly<
  Record<
    Language,
    {
      readonly mine: string;
      readonly invitations: string;
      readonly deadlines: string;
      readonly due: (key: string) => string;
      readonly milestone: (name: string) => string;
    }
  >
> = {
  de: {
    mine: "Meine Termine",
    invitations: "Einladungen",
    deadlines: "Fälligkeiten und Meilensteine",
    due: (key) => `${key} fällig`,
    milestone: (name) => `Meilenstein ${name}`,
  },
  en: {
    mine: "My events",
    invitations: "Invitations",
    deadlines: "Due dates and milestones",
    due: (key) => `${key} due`,
    milestone: (name) => `Milestone ${name}`,
  },
};

const PROJECT_DATE_MINUTES = 60;
const SEPARATOR = "~";

/**
 * Returns the server texts of a language.
 *
 * @param language - The language of the viewer.
 */
export function calendarTexts(language: Language): (typeof TEXTS)[Language] {
  return TEXTS[language];
}

/**
 * Builds the id of an occurrence of a series.
 *
 * @param eventId - The series.
 * @param key - The stored key of the occurrence.
 */
export function occurrenceEntryId(eventId: string, key: string): string {
  return `${eventId}${SEPARATOR}${key}`;
}

/**
 * Splits an entry id into the event and the key of an occurrence.
 *
 * @param id - An entry id or an event id.
 * @returns The event id and the occurrence key, `null` without one.
 */
export function parseEntryId(id: string): {
  readonly eventId: string;
  readonly key: string | null;
} {
  const index = id.indexOf(SEPARATOR);
  return index < 0
    ? { eventId: id, key: null }
    : { eventId: id.slice(0, index), key: id.slice(index + 1) };
}

/**
 * Formats the start and end of an occurrence for a viewer.
 *
 * @param time - The occurrence.
 * @param timeZone - The zone of the viewer.
 */
export function formatOccurrence(
  time: OccurrenceTime,
  timeZone: string,
): { readonly start: string; readonly end: string } {
  if (time.allDay) return { start: time.startDate, end: time.endDate };
  return {
    start: formatInZone(time.startMs ?? 0, timeZone),
    end: formatInZone(time.endMs ?? 0, timeZone),
  };
}

/**
 * Formats a stored occurrence key for a viewer.
 *
 * @param key - A date or UTC text.
 * @param timeZone - The zone of the viewer.
 */
export function formatOccurrenceKey(key: string, timeZone: string): string {
  return key.length === 10 ? key : formatInZone(Date.parse(key), timeZone);
}

function calendarOfEvent(
  event: CalendarEventRecord,
  viewer: CalendarViewer,
  projectNames: ReadonlyMap<string, string>,
): CalendarOfEntry {
  const texts = TEXTS[viewer.language];
  if (event.projectId !== null)
    return {
      kind: "project",
      projectId: event.projectId,
      name: projectNames.get(event.projectId) ?? event.projectId,
    };
  return {
    kind: "personal",
    projectId: null,
    name: event.createdBy === viewer.user.id ? texts.mine : texts.invitations,
  };
}

/** What one event entry is built from. */
export interface EventEntryInput {
  readonly event: CalendarEventRecord;
  readonly occurrence: CalendarOccurrence;
  readonly participants: CalendarParticipants;
  readonly viewer: CalendarViewer;
  readonly projectNames: ReadonlyMap<string, string>;
  /** Whether the viewer is an agent; agents always stay open. */
  readonly isViewerAgent: boolean;
}

/**
 * Builds the entry of one occurrence of a stored event.
 *
 * @param input - Event, occurrence, participants and viewer.
 */
export function toEventEntry(input: EventEntryInput): CalendarViewEntry {
  const { event, occurrence, participants, viewer } = input;
  const isInvited = participants.affectedIds.has(viewer.user.id);
  const own = participants.responses.find(
    (entry) => entry.userId === viewer.user.id,
  );
  const times = formatOccurrence(occurrence, viewer.timeZone);
  const isRecurring = event.recurrence !== null && occurrence.key !== null;
  const myResponse = input.isViewerAgent ? "open" : (own?.response ?? "open");
  return {
    id:
      isRecurring && occurrence.key !== null
        ? occurrenceEntryId(event.id, occurrence.key)
        : event.id,
    seriesId: isRecurring ? event.id : null,
    occurrenceStart:
      occurrence.key === null
        ? null
        : formatOccurrenceKey(occurrence.key, viewer.timeZone),
    title: occurrence.title,
    description: occurrence.description,
    ...times,
    allDay: occurrence.allDay,
    calendar: calendarOfEvent(event, viewer, input.projectNames),
    invitees: participants.invitees,
    responses: participants.responses,
    myResponse: isInvited ? myResponse : null,
    recurrence: event.recurrence,
    source: { kind: "event", ticketKey: null },
    createdBy: participants.createdBy,
    editable: event.createdBy === viewer.user.id || viewer.isAdmin,
    details: {
      eventId: event.id,
      link: null,
      createdByMe: event.createdBy === viewer.user.id,
    },
  };
}

function derivedEntry(
  fields: Pick<
    CalendarViewEntry,
    "id" | "title" | "description" | "start" | "end" | "allDay" | "calendar" | "source"
  >,
  link: string,
): CalendarViewEntry {
  return {
    ...fields,
    seriesId: null,
    occurrenceStart: null,
    invitees: [],
    responses: [],
    myResponse: null,
    recurrence: null,
    createdBy: null,
    editable: false,
    details: { eventId: null, link, createdByMe: false },
  };
}

/**
 * Builds the entry of a project date; it is edited in the project.
 *
 * @param record - The project date.
 * @param viewer - The viewer; a date with time is read in their zone.
 */
export function toProjectDateEntry(
  record: CalendarProjectDateRecord,
  viewer: CalendarViewer,
): CalendarViewEntry {
  const calendar: CalendarOfEntry = {
    kind: "project",
    projectId: record.projectId,
    name: record.projectName,
  };
  const link = `/projekte/${encodeURIComponent(record.projectId)}`;
  const base = {
    id: `project-event:${record.id}`,
    title: record.title,
    description: record.description,
    calendar,
    source: { kind: "project_event" as const, ticketKey: null },
  };
  if (record.time === null)
    return derivedEntry(
      { ...base, start: record.date, end: record.date, allDay: true },
      link,
    );
  const startMs = fromLocal(
    { date: record.date, time: `${record.time}:00` },
    viewer.timeZone,
  );
  return derivedEntry(
    {
      ...base,
      start: formatInZone(startMs, viewer.timeZone),
      end: formatInZone(startMs + PROJECT_DATE_MINUTES * 60_000, viewer.timeZone),
      allDay: false,
    },
    link,
  );
}

/**
 * Builds the all-day entry "<key> due" of a ticket.
 *
 * @param record - The ticket.
 * @param viewer - The viewer.
 */
export function toDueEntry(
  record: CalendarDueTicketRecord,
  viewer: CalendarViewer,
): CalendarViewEntry {
  const texts = TEXTS[viewer.language];
  return derivedEntry(
    {
      id: `due:${record.id}`,
      title: texts.due(record.key),
      description: record.title,
      start: record.date,
      end: record.date,
      allDay: true,
      calendar: { kind: "due", projectId: record.projectId, name: texts.deadlines },
      source: { kind: "ticket", ticketKey: record.key },
    },
    `/aufgaben/${encodeURIComponent(record.key)}`,
  );
}

/**
 * Builds the all-day entry of a milestone.
 *
 * @param record - The milestone.
 * @param viewer - The viewer.
 */
export function toMilestoneEntry(
  record: CalendarMilestoneRecord,
  viewer: CalendarViewer,
): CalendarViewEntry {
  const texts = TEXTS[viewer.language];
  return derivedEntry(
    {
      id: `milestone:${record.id}`,
      title: texts.milestone(record.name),
      description: record.description,
      start: record.date,
      end: record.date,
      allDay: true,
      calendar: {
        kind: "milestone",
        projectId: record.projectId,
        name: texts.deadlines,
      },
      source: { kind: "milestone", ticketKey: null },
    },
    `/projekte/${encodeURIComponent(record.projectId)}`,
  );
}

/**
 * Orders entries: by start, all-day ones first on their day, then by title.
 *
 * @param left - One entry.
 * @param right - Another entry.
 */
export function compareEntries(
  left: CalendarViewEntry,
  right: CalendarViewEntry,
): number {
  const leftDay = left.start.slice(0, 10);
  const rightDay = right.start.slice(0, 10);
  if (leftDay !== rightDay) return leftDay < rightDay ? -1 : 1;
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
  if (left.start !== right.start) return left.start < right.start ? -1 : 1;
  return left.title.localeCompare(right.title);
}

/**
 * Returns the day after a date, for exclusive ends.
 *
 * @param date - `YYYY-MM-DD`.
 */
export function nextDay(date: string): string {
  return addDays(date, 1);
}
