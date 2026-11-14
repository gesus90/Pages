import type {
  CalendarEventPermissions,
  CalendarEventView,
  CalendarViewEntry,
} from "@/definition/Calendar";
import type {
  McpCalendarEvent,
  McpCalendarEventAnswer,
  McpCalendarListEntry,
} from "./McpCalendarContract";

/** What a read-only agent may do with any event: nothing but read it. */
const READ_ONLY_PERMISSIONS: CalendarEventPermissions = {
  canEdit: false,
  canDelete: false,
  canRespond: false,
};

/**
 * Projects an entry of the calendar service onto the list entry of the API.
 *
 * @param entry - An entry of a range read.
 * @param isReadOnly - Whether the account may only read; then nothing is editable.
 * @returns The list entry; description, invitees and answers stay out of the list.
 */
export function listEntryOf(
  entry: CalendarViewEntry,
  isReadOnly: boolean,
): McpCalendarListEntry {
  return {
    id: entry.id,
    eventId: entry.details.eventId,
    occurrenceStart: entry.occurrenceStart,
    title: entry.title,
    start: entry.start,
    end: entry.end,
    allDay: entry.allDay,
    calendar: {
      kind: entry.calendar.kind,
      projectId: entry.calendar.projectId,
      name: entry.calendar.name,
    },
    source: { kind: entry.source.kind, ticketKey: entry.source.ticketKey },
    myResponse: entry.myResponse,
    editable: entry.editable && !isReadOnly,
  };
}

/**
 * Projects a stored event onto the answer of `read_calendar_event`.
 *
 * @param view - The detail read of the calendar service.
 * @param isReadOnly - Whether the account may only read; then every permission is `false`.
 * @returns The event with the time zone its times are given in.
 */
export function eventAnswerOf(
  view: CalendarEventView,
  isReadOnly: boolean,
): McpCalendarEventAnswer {
  const permissions = isReadOnly
    ? READ_ONLY_PERMISSIONS
    : {
        canEdit: view.permissions.canEdit,
        canDelete: view.permissions.canDelete,
        canRespond: view.permissions.canRespond,
      };
  const event: McpCalendarEvent = {
    id: view.id,
    eventId: view.id,
    occurrenceStart: null,
    title: view.title,
    start: view.start,
    end: view.end,
    allDay: view.allDay,
    calendar: {
      kind: view.calendar.kind,
      projectId: view.calendar.projectId,
      name: view.calendar.name,
    },
    source: { kind: "event", ticketKey: null },
    myResponse: view.myResponse,
    editable: permissions.canEdit,
    description: view.description,
    recurrence: view.recurrence,
    invitees: view.invitees,
    responses: view.responses,
    createdBy: view.createdBy,
    exceptions: view.exceptions,
    permissions,
    revision: view.revision,
  };
  return { timeZone: view.timeZone, event };
}
