import {
  PICA_MOBILE_CLIENT_MESSAGE_TYPE,
  PICA_MOBILE_ERROR_CODE,
  PICA_MOBILE_PROTOCOL_VERSION,
} from "@/definition/PicaMobileProtocol";
import { picaMobileCalendarRequestSchema } from "@/definition/PicaMobileCalendar";

import type { CalendarEntry, CalendarViewEntry } from "@/definition/Calendar";
import type {
  PicaMobileCalendarAnswer,
  PicaMobileCalendarRequest,
  PicaMobileCalendarRequestType,
} from "@/definition/PicaMobileCalendar";
import type { PicaMobileRejection } from "../PicaMobileMessages";

/** A request of `calendar.v1` that passed every check of its payload. */
export type PicaMobileCalendarClientMessage = PicaMobileCalendarRequest & {
  readonly requestId: string;
};

/** The outcome of reading the payload of a calendar request. */
export type PicaMobileCalendarParseResult =
  | { readonly ok: true; readonly message: PicaMobileCalendarClientMessage }
  | { readonly ok: false; readonly rejection: PicaMobileRejection };

const CALENDAR_REQUEST_TYPES: ReadonlySet<string> =
  new Set<PicaMobileCalendarRequestType>([
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CALENDAR_RANGE,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CALENDAR_EVENT_SAVE,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CALENDAR_EVENT_DELETE,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CALENDAR_EVENT_RESPOND,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CALENDAR_INVITEES,
    PICA_MOBILE_CLIENT_MESSAGE_TYPE.CALENDAR_TARGETS,
  ]);

/**
 * Tells whether a message type belongs to `calendar.v1`.
 *
 * @param type - The type of a checked message.
 * @returns `true` for the six calendar requests.
 */
export function isPicaMobileCalendarType(type: string): boolean {
  return CALENDAR_REQUEST_TYPES.has(type);
}

/**
 * Tells whether a checked message is a request of `calendar.v1`.
 *
 * @param message - A message that passed every check of its payload.
 * @returns `true` for the six calendar requests.
 */
export function isPicaMobileCalendarMessage(message: {
  readonly type: string;
}): message is PicaMobileCalendarClientMessage {
  return CALENDAR_REQUEST_TYPES.has(message.type);
}

/**
 * Reads a request of `calendar.v1`.
 *
 * @param type - The type of the envelope.
 * @param requestId - The checked request identifier.
 * @param payload - The payload object of the envelope.
 * @returns The message or its rejection; `null` when the type belongs to no
 * calendar request.
 *
 * @remarks
 * A payload that breaks the contract, such as an invalid recurrence, is
 * refused with `invalid_request`, the code the app shows for every rule of
 * the calendar.
 */
export function parsePicaMobileCalendarPayload(
  type: string,
  requestId: string,
  payload: Readonly<Record<string, unknown>>,
): PicaMobileCalendarParseResult | null {
  if (!CALENDAR_REQUEST_TYPES.has(type)) return null;
  const parsed = picaMobileCalendarRequestSchema.safeParse({ type, payload });
  return parsed.success
    ? { ok: true, message: { ...parsed.data, requestId } }
    : {
        ok: false,
        rejection: {
          code: PICA_MOBILE_ERROR_CODE.INVALID_REQUEST,
          message: `The payload of "${type}" is invalid.`,
          requestId,
        },
      };
}

/**
 * Reduces an entry of the calendar service to the `CalendarEntry` of the app.
 *
 * @param entry - An entry, possibly with the details of the web interface.
 * @returns Only the fields of the contract; `details` never leaves Pages.
 */
export function toPicaMobileCalendarEntry(
  entry: CalendarEntry | CalendarViewEntry,
): CalendarEntry {
  return {
    id: entry.id,
    seriesId: entry.seriesId,
    occurrenceStart: entry.occurrenceStart,
    title: entry.title,
    description: entry.description,
    start: entry.start,
    end: entry.end,
    allDay: entry.allDay,
    calendar: entry.calendar,
    invitees: entry.invitees,
    responses: entry.responses,
    myResponse: entry.myResponse,
    recurrence: entry.recurrence,
    source: entry.source,
    createdBy: entry.createdBy,
    editable: entry.editable,
  };
}

/**
 * Builds the text frame of a message of `calendar.v1`.
 *
 * @param requestId - Identifier of the request that is answered; `null` for
 * `calendar_changed`.
 * @param answer - Type and payload of the message.
 * @returns The frame content.
 */
export function encodePicaMobileCalendar(
  requestId: string | null,
  answer: PicaMobileCalendarAnswer,
): string {
  return JSON.stringify({
    version: PICA_MOBILE_PROTOCOL_VERSION,
    requestId,
    ...answer,
  });
}
