import { z } from "zod";

/** Limits of the calendar shared by the interface, the app, Pica and MCP (PAGE-301). */
export const CALENDAR_LIMITS = {
  titleCharacters: 200,
  descriptionCharacters: 10_000,
  invitees: 100,
  rangeDays: 92,
  rangeEntries: 2_000,
  intervalMaximum: 99,
  countMaximum: 999,
  mobileInviteeOptions: 20,
  mcpInviteeOptions: 50,
  listDays: 30,
} as const;

/** Who can be invited to an event. */
export const CALENDAR_INVITEE_KINDS = [
  "person",
  "agent",
  "group",
  "department",
] as const;

/** One kind of {@link CALENDAR_INVITEE_KINDS}. */
export type CalendarInviteeKind = (typeof CALENDAR_INVITEE_KINDS)[number];

/** The answer of one invited person; `open` until they answer. */
export type CalendarResponse = "accepted" | "declined" | "open";

/** The answer a person can give. */
export type CalendarAnswer = Exclude<CalendarResponse, "open">;

/** The calendars an entry can belong to. */
export const CALENDAR_KINDS = [
  "personal",
  "project",
  "due",
  "milestone",
] as const;

/** One kind of {@link CALENDAR_KINDS}. */
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/** Where an entry comes from. */
export type CalendarSourceKind =
  "event" | "project_event" | "ticket" | "milestone";

/** Which occurrences of a series a change or a deletion covers. */
export const CALENDAR_SCOPES = ["this", "following", "all"] as const;

/** One scope of {@link CALENDAR_SCOPES}. */
export type CalendarScope = (typeof CALENDAR_SCOPES)[number];

/** The weekdays of a weekly rule, Monday first. */
export const CALENDAR_WEEKDAYS = [
  "mo",
  "tu",
  "we",
  "th",
  "fr",
  "sa",
  "su",
] as const;

/** One weekday of {@link CALENDAR_WEEKDAYS}. */
export type CalendarWeekday = (typeof CALENDAR_WEEKDAYS)[number];

/** How often a series repeats. */
export const CALENDAR_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;

/** One frequency of {@link CALENDAR_FREQUENCIES}. */
export type CalendarFrequency = (typeof CALENDAR_FREQUENCIES)[number];

/**
 * The rule of a series.
 *
 * @remarks
 * `weekdays` is used only for `weekly` and empty otherwise; at most one of
 * `until` (inclusive date `YYYY-MM-DD`) and `count` is set.
 */
export interface CalendarRecurrence {
  readonly frequency: CalendarFrequency;
  readonly interval: number;
  readonly weekdays: readonly CalendarWeekday[];
  readonly until: string | null;
  readonly count: number | null;
}

/** An invitee as entries name it. */
export interface CalendarInvitee {
  readonly kind: CalendarInviteeKind;
  readonly id: string;
  readonly name: string;
}

/** The answer of one affected person; agents always stay `open`. */
export interface CalendarPersonResponse {
  readonly userId: string;
  readonly name: string;
  readonly response: CalendarResponse;
}

/** The calendar an entry belongs to. */
export interface CalendarOfEntry {
  readonly kind: CalendarKind;
  readonly projectId: string | null;
  readonly name: string;
}

/** Where an entry comes from; `ticketKey` only for due tickets. */
export interface CalendarSource {
  readonly kind: CalendarSourceKind;
  readonly ticketKey: string | null;
}

/** A person as entries name them. */
export interface CalendarPerson {
  readonly id: string;
  readonly name: string;
}

/**
 * One entry of the calendar, the `CalendarEntry` of `calendar.v1`.
 *
 * @remarks
 * Times are ISO-8601 with the offset of the viewer's time zone; an all-day
 * entry carries only dates, `end` being its last day (inclusive). For a
 * recurring event every occurrence has its own `id`, `seriesId` names the
 * series and `occurrenceStart` the original start of the occurrence.
 */
export interface CalendarEntry {
  readonly id: string;
  readonly seriesId: string | null;
  readonly occurrenceStart: string | null;
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly calendar: CalendarOfEntry;
  readonly invitees: readonly CalendarInvitee[];
  readonly responses: readonly CalendarPersonResponse[];
  readonly myResponse: CalendarResponse | null;
  readonly recurrence: CalendarRecurrence | null;
  readonly source: CalendarSource;
  readonly createdBy: CalendarPerson | null;
  readonly editable: boolean;
}

/**
 * Additional facts of an entry that the interface needs.
 *
 * @remarks
 * `eventId` is the stored event (or series) behind an entry of kind `event`,
 * `null` for project dates, due tickets and milestones; `link` leads to the
 * source of a derived entry.
 */
export interface CalendarEntryDetails {
  readonly eventId: string | null;
  readonly link: string | null;
  readonly createdByMe: boolean;
}

/** An entry with the details of {@link CalendarEntryDetails}. */
export interface CalendarViewEntry extends CalendarEntry {
  readonly details: CalendarEntryDetails;
}

/** The entries of a range, the payload of `calendar` of `calendar.v1`. */
export interface CalendarRange {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly entries: readonly CalendarViewEntry[];
}

/** One calendar a new event can be put into; `projectId: null` is "my events". */
export interface CalendarTarget {
  readonly projectId: string | null;
  readonly name: string;
}

/** An occurrence that was changed or cancelled on its own. */
export interface CalendarException {
  readonly occurrenceStart: string;
  readonly isCancelled: boolean;
}

/** What an account may do with one event. */
export interface CalendarEventPermissions {
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly canRespond: boolean;
}

/** One stored event with everything a detail read names. */
export interface CalendarEventView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly timeZone: string;
  readonly calendar: CalendarOfEntry;
  readonly recurrence: CalendarRecurrence | null;
  readonly invitees: readonly CalendarInvitee[];
  readonly responses: readonly CalendarPersonResponse[];
  readonly myResponse: CalendarResponse | null;
  readonly createdBy: CalendarPerson;
  readonly exceptions: readonly CalendarException[];
  readonly permissions: CalendarEventPermissions;
  readonly revision: number;
}

/** The fixed facts a calendar client needs before it changes something. */
export interface CalendarOptions {
  readonly timeZone: string;
  readonly targets: readonly CalendarTarget[];
  readonly frequencies: readonly CalendarFrequency[];
  readonly weekdays: readonly CalendarWeekday[];
  readonly scopes: readonly CalendarScope[];
  readonly limits: typeof CALENDAR_LIMITS;
}

/** The result of a deletion that waits for a confirmation. */
export interface CalendarDeletionPreview {
  readonly confirmationRequired: true;
  readonly event: {
    readonly id: string;
    readonly title: string;
    readonly start: string;
  };
  readonly scope: CalendarScope;
  readonly affectedOccurrences: number | "unbegrenzt";
  readonly invitedCount: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** A calendar date `YYYY-MM-DD` that exists. */
export const calendarDateSchema = z
  .string()
  .regex(DATE_PATTERN)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  }, "invalid date");

/** A date `YYYY-MM-DD` or an ISO-8601 instant with an offset or `Z`. */
export const calendarTimeSchema = z
  .string()
  .min(10)
  .max(40)
  .refine(
    (value) =>
      DATE_PATTERN.test(value) ||
      (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
        value,
      ) &&
        !Number.isNaN(Date.parse(value))),
    "invalid time",
  );

/** The rule of a series as clients send it. */
export const calendarRecurrenceSchema = z
  .object({
    frequency: z.enum(CALENDAR_FREQUENCIES),
    interval: z.number().int().min(1).max(CALENDAR_LIMITS.intervalMaximum),
    weekdays: z.array(z.enum(CALENDAR_WEEKDAYS)).max(7).default([]),
    until: calendarDateSchema.nullable().default(null),
    count: z
      .number()
      .int()
      .min(1)
      .max(CALENDAR_LIMITS.countMaximum)
      .nullable()
      .default(null),
  })
  .refine((rule) => rule.until === null || rule.count === null, {
    message: "until and count exclude each other",
  })
  .refine((rule) => rule.frequency === "weekly" || rule.weekdays.length === 0, {
    message: "weekdays only for weekly",
  });

/** An invitee as clients send it. */
export const calendarInviteeReferenceSchema = z.object({
  kind: z.enum(CALENDAR_INVITEE_KINDS),
  id: z.string().min(1).max(200),
});

/** An invitee reference of {@link calendarInviteeReferenceSchema}. */
export type CalendarInviteeReference = z.infer<
  typeof calendarInviteeReferenceSchema
>;

/** The fields of an event as clients send them for a new event or a whole change. */
export const calendarEventFieldsSchema = z.object({
  title: z.string().trim().min(1).max(CALENDAR_LIMITS.titleCharacters),
  description: z
    .string()
    .max(CALENDAR_LIMITS.descriptionCharacters)
    .default(""),
  start: calendarTimeSchema,
  end: calendarTimeSchema,
  allDay: z.boolean(),
  calendarProjectId: z.string().min(1).max(200).nullable().default(null),
  invitees: z
    .array(calendarInviteeReferenceSchema)
    .max(CALENDAR_LIMITS.invitees)
    .default([]),
  recurrence: calendarRecurrenceSchema.nullable().default(null),
});

/** The checked fields of {@link calendarEventFieldsSchema}. */
export type CalendarEventFields = z.infer<typeof calendarEventFieldsSchema>;

/** A partial change; fields that are left out stay as they are. */
export type CalendarEventPatch = Partial<CalendarEventFields>;

/** The patch of an event as clients send it. */
export const calendarEventPatchSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(CALENDAR_LIMITS.titleCharacters)
    .optional(),
  description: z.string().max(CALENDAR_LIMITS.descriptionCharacters).optional(),
  start: calendarTimeSchema.optional(),
  end: calendarTimeSchema.optional(),
  allDay: z.boolean().optional(),
  calendarProjectId: z.string().min(1).max(200).nullable().optional(),
  invitees: z
    .array(calendarInviteeReferenceSchema)
    .max(CALENDAR_LIMITS.invitees)
    .optional(),
  recurrence: calendarRecurrenceSchema.nullable().optional(),
});

/** A range as clients ask for it; `from` and `to` are dates or instants. */
export const calendarRangeSchema = z.object({
  from: calendarTimeSchema,
  to: calendarTimeSchema,
});

/** The answer of a response request. */
export const calendarAnswerSchema = z.enum(["accepted", "declined"]);

/** Filters of the interface: which calendars are shown. */
export type CalendarFilterKey =
  "mine" | "invitations" | "deadlines" | `project:${string}`;

/** The views of the calendar page. */
export const CALENDAR_VIEWS = ["day", "week", "month", "list"] as const;

/** One view of {@link CALENDAR_VIEWS}. */
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/**
 * Tells which filter of the page an entry belongs to.
 *
 * @param entry - An entry with its details.
 * @returns `deadlines` for due tickets and milestones, the project of a
 * project calendar, `mine` for own events and `invitations` otherwise.
 */
export function calendarFilterOf(entry: CalendarViewEntry): CalendarFilterKey {
  if (entry.calendar.kind === "due" || entry.calendar.kind === "milestone")
    return "deadlines";
  if (entry.calendar.kind === "project" && entry.calendar.projectId !== null)
    return `project:${entry.calendar.projectId}`;
  return entry.details.createdByMe ? "mine" : "invitations";
}
