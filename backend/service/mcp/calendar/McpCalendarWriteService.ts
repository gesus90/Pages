import { eventAnswerOf } from "./McpCalendarProjection";

import type { CalendarViewEntry } from "@/definition/Calendar";
import type {
  McpCalendarEventAnswer,
  McpCalendarOutcome,
} from "./McpCalendarContract";
import type { McpCalendarContext } from "./McpCalendarContext";
import type {
  McpCalendarCreateRequest,
  McpCalendarRespondRequest,
  McpCalendarUpdateRequest,
} from "./McpCalendarRequest";

/** Reads the stored event behind the entry a change answered with. */
async function storedEvent(
  context: McpCalendarContext,
  entry: CalendarViewEntry,
  fallbackId: string,
): Promise<McpCalendarEventAnswer> {
  const view = await context.calendar.readEvent(
    context.actor,
    entry.details.eventId ?? fallbackId,
  );
  return eventAnswerOf(view, context.isReadOnly);
}

/**
 * Creates, changes and answers events (PAGE-301).
 *
 * @remarks
 * Every change runs once per operation ID of the account: the same call
 * again answers the stored answer without a second event, the same ID with
 * another request is a `conflict`. A read-only agent is refused before the
 * journal is asked. Each answer is the stored event as `read_calendar_event`
 * shows it.
 */
export class McpCalendarWriteService {
  /**
   * Creates an event; the creator is always the authenticated account
   * (create_calendar_event).
   *
   * @param context - The request.
   * @param request - Operation ID and the fields of the event.
   * @throws {McpCalendarError} `forbidden` for a read-only agent.
   * @throws {CalendarError} `forbidden` for a project calendar the account
   * may not write in, `invalid_request` for invalid times, rules or invitees,
   * `conflict` for an operation ID of another request.
   */
  public async create(
    context: McpCalendarContext,
    request: McpCalendarCreateRequest,
  ): Promise<McpCalendarOutcome<McpCalendarEventAnswer>> {
    context.requireWriter();
    const { actor, calendar } = context;
    return calendar.runOnce(
      actor,
      {
        operationId: request.operationId,
        request: { operation: "create_calendar_event", ...request.fields },
      },
      async () => {
        const entry = await calendar.create(actor, request.fields);
        return storedEvent(context, entry, entry.id);
      },
    );
  }

  /**
   * Changes an event or a scope of a series (update_calendar_event).
   *
   * @param context - The request.
   * @param eventId - The event or one of its occurrences.
   * @param request - Operation ID, target and the named fields.
   * @throws {McpCalendarError} `forbidden` for a read-only agent,
   * `invalid_request` for a series without a scope.
   * @throws {CalendarError} `not_found`, `forbidden` for anyone but the
   * creator or an administrator, `conflict` with `currentRevision` for a
   * stale revision, `invalid_request` for invalid fields.
   */
  public async update(
    context: McpCalendarContext,
    eventId: string,
    request: McpCalendarUpdateRequest,
  ): Promise<McpCalendarOutcome<McpCalendarEventAnswer>> {
    context.requireWriter();
    const { actor, calendar } = context;
    return calendar.runOnce(
      actor,
      {
        operationId: request.operationId,
        request: {
          operation: "update_calendar_event",
          eventId,
          ...request.target,
          patch: request.patch,
        },
      },
      async () => {
        const target = await context.target(eventId, request.target);
        const entry = await calendar.update(actor, target, request.patch);
        return storedEvent(context, entry, eventId);
      },
    );
  }

  /**
   * Answers an invitation for the whole series (respond_calendar_event).
   *
   * @param context - The request.
   * @param eventId - The event or one of its occurrences.
   * @param request - Operation ID and the answer.
   * @throws {McpCalendarError} `forbidden` for a read-only agent.
   * @throws {CalendarError} `forbidden` for anyone not invited, the creator
   * and agents, `not_found` for a missing or invisible event.
   */
  public async respond(
    context: McpCalendarContext,
    eventId: string,
    request: McpCalendarRespondRequest,
  ): Promise<McpCalendarOutcome<McpCalendarEventAnswer>> {
    context.requireWriter();
    const { actor, calendar } = context;
    return calendar.runOnce(
      actor,
      {
        operationId: request.operationId,
        request: {
          operation: "respond_calendar_event",
          eventId,
          response: request.response,
        },
      },
      async () => {
        const entry = await calendar.respond(actor, eventId, request.response);
        return storedEvent(context, entry, eventId);
      },
    );
  }
}
