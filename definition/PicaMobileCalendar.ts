import { z } from "zod";

import {
  CALENDAR_SCOPES,
  calendarAnswerSchema,
  calendarEventFieldsSchema,
  calendarRangeSchema,
} from "./Calendar";

import type {
  CalendarEntry,
  CalendarInvitee,
  CalendarTarget,
} from "./Calendar";

/** An entry id of `calendar.v1`: an event, `<eventId>~<key>` for an occurrence. */
const calendarEntryIdSchema = z.string().min(1).max(200);

/**
 * The payload of `calendar_event_save`: the whole event, with `id: null` for
 * a new one.
 *
 * @remarks
 * `scope` decides which occurrences of a series a change covers; a new event
 * ignores it, a change must name it.
 */
const calendarEventSavePayloadSchema = calendarEventFieldsSchema
  .extend({
    id: calendarEntryIdSchema.nullable(),
    scope: z.enum(CALENDAR_SCOPES).optional(),
  })
  .refine((payload) => payload.id === null || payload.scope !== undefined, {
    message: "a change names its scope",
  });

/**
 * The requests of `calendar.v1` (PAGE-301), each with its payload.
 *
 * @remarks
 * The fields are checked here as far as they stand alone; whether a range
 * keeps 92 days, an event ends after its start or an id names a visible
 * event, the calendar service decides.
 */
export const picaMobileCalendarRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("calendar_range"), payload: calendarRangeSchema }),
  z.object({
    type: z.literal("calendar_event_save"),
    payload: calendarEventSavePayloadSchema,
  }),
  z.object({
    type: z.literal("calendar_event_delete"),
    payload: z.object({
      id: calendarEntryIdSchema,
      scope: z.enum(CALENDAR_SCOPES),
    }),
  }),
  z.object({
    type: z.literal("calendar_event_respond"),
    payload: z.object({
      id: calendarEntryIdSchema,
      response: calendarAnswerSchema,
    }),
  }),
  z.object({
    type: z.literal("calendar_invitees"),
    payload: z.object({ query: z.string().max(200) }),
  }),
  z.object({ type: z.literal("calendar_targets"), payload: z.object({}) }),
]);

/** A request of `calendar.v1` with its checked payload, without the envelope. */
export type PicaMobileCalendarRequest = z.infer<
  typeof picaMobileCalendarRequestSchema
>;

/** The type of a request of `calendar.v1`. */
export type PicaMobileCalendarRequestType = PicaMobileCalendarRequest["type"];

/** The answer to `calendar_range`: the entries in the account's zone. */
export interface PicaMobileCalendarRangePayload {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly entries: readonly CalendarEntry[];
}

/** A message of `calendar.v1` the server sends, without its envelope. */
export type PicaMobileCalendarAnswer =
  | {
      readonly type: "calendar";
      readonly payload: PicaMobileCalendarRangePayload;
    }
  | {
      readonly type: "calendar_event";
      readonly payload: { readonly entry: CalendarEntry };
    }
  | {
      readonly type: "calendar_event_deleted";
      readonly payload: { readonly id: string };
    }
  | {
      readonly type: "calendar_invitee_options";
      readonly payload: { readonly options: readonly CalendarInvitee[] };
    }
  | {
      readonly type: "calendar_target_options";
      readonly payload: { readonly targets: readonly CalendarTarget[] };
    }
  | {
      /** Sent on its own whenever entries the account sees changed. */
      readonly type: "calendar_changed";
      readonly payload: { readonly ids: readonly string[] };
    };
