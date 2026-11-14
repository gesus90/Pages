import { CALENDAR_LIMITS } from "@/definition/Calendar";

import { McpCalendarError } from "./McpCalendarError";
import { eventAnswerOf, listEntryOf } from "./McpCalendarProjection";

import type { CalendarOptions } from "@/definition/Calendar";
import type {
  McpCalendarEventAnswer,
  McpCalendarInviteesAnswer,
  McpCalendarRangeAnswer,
} from "./McpCalendarContract";
import type { McpCalendarContext } from "./McpCalendarContext";
import type {
  McpCalendarInviteeRequest,
  McpCalendarRangeRequest,
} from "./McpCalendarRequest";

/** Reads options, invitees, ranges and single events (PAGE-301); allowed to read-only agents too. */
export class McpCalendarReadService {
  /**
   * Reads the zone, the calendars an event may go into, the rule choices
   * and the limits (read_calendar_options).
   *
   * @param context - The request.
   */
  public async options(context: McpCalendarContext): Promise<CalendarOptions> {
    return context.calendar.options(context.actor);
  }

  /**
   * Searches whom the account may invite (search_calendar_invitees).
   *
   * @param context - The request.
   * @param request - Part of a name and at most 50 options.
   */
  public async invitees(
    context: McpCalendarContext,
    request: McpCalendarInviteeRequest,
  ): Promise<McpCalendarInviteesAnswer> {
    const options = await context.calendar.searchInvitees(
      context.actor,
      request.text,
      request.limit,
    );
    return {
      invitees: options.map((option) => ({
        kind: option.kind,
        id: option.id,
        name: option.name,
      })),
    };
  }

  /**
   * Lists the entries of a range of at most 92 days (list_calendar).
   *
   * @param context - The request.
   * @param request - `from`, `to` and the optional calendar filter.
   * @throws {CalendarError} `invalid_request` for an invalid or too long range.
   * @throws {McpCalendarError} `too_large` above 2,000 entries; the client asks for a shorter range.
   */
  public async list(
    context: McpCalendarContext,
    request: McpCalendarRangeRequest,
  ): Promise<McpCalendarRangeAnswer> {
    const range = await context.calendar.readRange(
      context.actor,
      { from: request.from, to: request.to },
      request.kinds === undefined ? {} : { kinds: request.kinds },
    );
    if (range.entries.length > CALENDAR_LIMITS.rangeEntries)
      throw new McpCalendarError("too_large");
    return {
      from: range.from,
      to: range.to,
      timeZone: range.timeZone,
      entries: range.entries.map((entry) =>
        listEntryOf(entry, context.isReadOnly),
      ),
    };
  }

  /**
   * Reads one stored event with its series, invitees, answers and revision
   * (read_calendar_event).
   *
   * @param context - The request.
   * @param eventId - The event or one of its occurrences.
   * @throws {CalendarError} `not_found` for a missing or invisible event,
   * and for project dates, due tickets and milestones, which are no events.
   */
  public async read(
    context: McpCalendarContext,
    eventId: string,
  ): Promise<McpCalendarEventAnswer> {
    const view = await context.calendar.readEvent(context.actor, eventId);
    return eventAnswerOf(view, context.isReadOnly);
  }
}
