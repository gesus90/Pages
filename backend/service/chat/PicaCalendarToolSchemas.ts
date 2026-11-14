import { z } from "zod";

import {
  CALENDAR_FREQUENCIES,
  CALENDAR_INVITEE_KINDS,
  CALENDAR_LIMITS,
  CALENDAR_SCOPES,
  CALENDAR_WEEKDAYS,
  calendarAnswerSchema,
  calendarDateSchema,
  calendarTimeSchema,
} from "@/definition/Calendar";

/** An entry id of `calendar_read` (an occurrence carries its own) or an event id. */
const entryId = z.string().min(1).max(300);

const projectId = z.string().min(1).max(200);

/*
 * The tool inputs leave every optional field optional instead of defaulting
 * it: a default would turn into a required property of the JSON Schema the
 * model reads. The calendar service fills the defaults when it checks them.
 */
const recurrence = z
  .object({
    frequency: z.enum(CALENDAR_FREQUENCIES),
    interval: z
      .number()
      .int()
      .min(1)
      .max(CALENDAR_LIMITS.intervalMaximum)
      .optional(),
    weekdays: z.array(z.enum(CALENDAR_WEEKDAYS)).max(7).optional(),
    until: calendarDateSchema.nullable().optional(),
    count: z
      .number()
      .int()
      .min(1)
      .max(CALENDAR_LIMITS.countMaximum)
      .nullable()
      .optional(),
  })
  .strict();

const invitee = z
  .object({
    kind: z.enum(CALENDAR_INVITEE_KINDS),
    id: z.string().min(1).max(200),
  })
  .strict();

const eventFields = {
  title: z.string().trim().min(1).max(CALENDAR_LIMITS.titleCharacters),
  description: z.string().max(CALENDAR_LIMITS.descriptionCharacters),
  start: calendarTimeSchema,
  end: calendarTimeSchema,
  allDay: z.boolean(),
  calendarProjectId: projectId.nullable(),
  invitees: z.array(invitee).max(CALENDAR_LIMITS.invitees),
  recurrence: recurrence.nullable(),
};

const target = {
  id: entryId,
  scope: z.enum(CALENDAR_SCOPES),
  occurrenceStart: calendarTimeSchema.nullable().optional(),
};

/** The native inputs of Pica's calendar tools (PAGE-301); the acting account is never a model argument. */
export const PICA_CALENDAR_SCHEMAS = {
  calendar_read: z
    .object({ from: calendarTimeSchema, to: calendarTimeSchema })
    .strict(),
  calendar_invitees_search: z
    .object({
      query: z.string().trim().min(1).max(200),
      limit: z
        .number()
        .int()
        .min(1)
        .max(CALENDAR_LIMITS.mcpInviteeOptions)
        .optional(),
    })
    .strict(),
  calendar_event_create: z
    .object({
      ...eventFields,
      description: eventFields.description.optional(),
      calendarProjectId: eventFields.calendarProjectId.optional(),
      invitees: eventFields.invitees.optional(),
      recurrence: eventFields.recurrence.optional(),
    })
    .strict(),
  calendar_event_update: z
    .object({
      ...target,
      title: eventFields.title.optional(),
      description: eventFields.description.optional(),
      start: eventFields.start.optional(),
      end: eventFields.end.optional(),
      allDay: eventFields.allDay.optional(),
      calendarProjectId: eventFields.calendarProjectId.optional(),
      invitees: eventFields.invitees.optional(),
      recurrence: eventFields.recurrence.optional(),
    })
    .strict(),
  calendar_event_respond: z
    .object({ id: entryId, response: calendarAnswerSchema })
    .strict(),
  calendar_event_delete: z
    .object({ ...target, confirmed: z.boolean().optional() })
    .strict(),
} as const;

/** One native calendar tool of {@link PICA_CALENDAR_SCHEMAS}. */
export type PicaCalendarTool = keyof typeof PICA_CALENDAR_SCHEMAS;

/** The checked recurrence of a calendar tool input. */
export type PicaCalendarRecurrence = z.infer<typeof recurrence>;
