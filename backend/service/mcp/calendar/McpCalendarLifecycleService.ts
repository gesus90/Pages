import type {
  McpCalendarDeleteAnswer,
  McpCalendarDeleted,
  McpCalendarOutcome,
} from "./McpCalendarContract";
import type { McpCalendarContext } from "./McpCalendarContext";
import type { McpCalendarDeleteRequest } from "./McpCalendarRequest";

/**
 * Deletes events in two steps (PAGE-301, delete_calendar_event).
 *
 * @remarks
 * Without `confirmed: true` nothing changes and the client receives the
 * question: the event, the scope, the number of occurrences that would go
 * (`"unbegrenzt"` for an endless series) and how many people are invited.
 * Only the confirmed call deletes, once per operation ID.
 */
export class McpCalendarLifecycleService {
  /**
   * Asks for or carries out the deletion of an event or a scope of a series.
   *
   * @param context - The request.
   * @param eventId - The event or one of its occurrences.
   * @param request - Operation ID, target and the confirmation.
   * @returns The question, or `{ deleted: true, eventId, scope }`.
   * @throws {McpCalendarError} `forbidden` for a read-only agent,
   * `invalid_request` for a series without a scope.
   * @throws {CalendarError} `not_found`, `forbidden` for anyone but the
   * creator or an administrator, `conflict` with `currentRevision` for a
   * stale revision.
   */
  public async delete(
    context: McpCalendarContext,
    eventId: string,
    request: McpCalendarDeleteRequest,
  ): Promise<McpCalendarOutcome<McpCalendarDeleteAnswer>> {
    context.requireWriter();
    const { actor, calendar } = context;
    if (!request.isConfirmed) {
      const target = await context.target(eventId, request.target);
      return {
        kind: "fresh",
        result: await calendar.previewDelete(actor, target),
      };
    }
    return calendar.runOnce(
      actor,
      {
        operationId: request.operationId,
        request: {
          operation: "delete_calendar_event",
          eventId,
          ...request.target,
        },
      },
      async (): Promise<McpCalendarDeleted> => {
        const target = await context.target(eventId, request.target);
        const deleted = await calendar.delete(actor, target);
        return { deleted: true, eventId: deleted.eventId, scope: target.scope };
      },
    );
  }
}
