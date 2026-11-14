import type {
  CalendarDeletionPreview,
  CalendarEventPermissions,
  CalendarException,
  CalendarInvitee,
  CalendarOfEntry,
  CalendarPerson,
  CalendarPersonResponse,
  CalendarRecurrence,
  CalendarResponse,
  CalendarScope,
  CalendarSource,
} from "@/definition/Calendar";

/**
 * One entry of `list_calendar`.
 *
 * @remarks
 * `id` names the entry (for a series: the occurrence), `eventId` the stored
 * event behind it, `null` for project dates, due tickets and milestones,
 * which are read-only (`editable: false`) and cannot be read as events.
 */
export interface McpCalendarListEntry {
  readonly id: string;
  readonly eventId: string | null;
  readonly occurrenceStart: string | null;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly calendar: CalendarOfEntry;
  readonly source: CalendarSource;
  readonly myResponse: CalendarResponse | null;
  readonly editable: boolean;
}

/** The answer of `list_calendar`. */
export interface McpCalendarRangeAnswer {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly entries: readonly McpCalendarListEntry[];
}

/**
 * A stored event as `read_calendar_event` names it: the fields of a list
 * entry and the details of the event.
 *
 * @remarks
 * `id` and `eventId` both name the stored event (the series of a recurring
 * one); `occurrenceStart` is `null` because the read describes the event as
 * a whole.
 */
export interface McpCalendarEvent extends McpCalendarListEntry {
  readonly description: string;
  readonly recurrence: CalendarRecurrence | null;
  readonly invitees: readonly CalendarInvitee[];
  readonly responses: readonly CalendarPersonResponse[];
  readonly createdBy: CalendarPerson;
  readonly exceptions: readonly CalendarException[];
  readonly permissions: CalendarEventPermissions;
  readonly revision: number;
}

/** The answer of `read_calendar_event`, and of a create, change or response. */
export interface McpCalendarEventAnswer {
  readonly timeZone: string;
  readonly event: McpCalendarEvent;
}

/** One person, agent, group or department the account may invite. */
export interface McpCalendarInviteeOption {
  readonly kind: CalendarInvitee["kind"];
  readonly id: string;
  readonly name: string;
}

/** The answer of `search_calendar_invitees`. */
export interface McpCalendarInviteesAnswer {
  readonly invitees: readonly McpCalendarInviteeOption[];
}

/** The answer of a confirmed `delete_calendar_event`. */
export interface McpCalendarDeleted {
  readonly deleted: true;
  readonly eventId: string;
  readonly scope: CalendarScope;
}

/** The answer of `delete_calendar_event`: the question, or the deletion. */
export type McpCalendarDeleteAnswer =
  CalendarDeletionPreview | McpCalendarDeleted;

/**
 * The answer of a change with an operation ID.
 *
 * @remarks
 * `replayed` answers are the stored answer of the first call, read back
 * from the operation journal and passed on unchanged.
 */
export type McpCalendarOutcome<Answer> =
  | { readonly kind: "fresh"; readonly result: Answer }
  | { readonly kind: "replayed"; readonly result: unknown };
