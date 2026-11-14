import { McpCalendarError } from "./McpCalendarError";

import type { CalendarService } from "@/backend/service/calendar/CalendarService";
import type { CalendarTargetRequest } from "@/backend/service/calendar/CalendarWriter";
import type { User } from "@/definition/User";
import type { McpCalendarTarget } from "./McpCalendarRequest";

/**
 * The calendar service the API calls: the very one of the interface, Pica
 * Mobile and Pica.
 *
 * @remarks
 * The API adds no business logic and no right of its own: visibility, edit
 * rights, revisions and the semantics of scopes stay with the service.
 */
export type McpCalendarService = Pick<
  CalendarService,
  | "readRange"
  | "readEvent"
  | "create"
  | "update"
  | "respond"
  | "delete"
  | "previewDelete"
  | "searchInvitees"
  | "options"
  | "runOnce"
>;

/** What one request of the calendar API is opened with. */
export interface McpCalendarContextInput {
  /** The account the device token acts for. */
  readonly actor: User;
  /** Whether the account is an agent whose access allows reading only. */
  readonly isReadOnly: boolean;
  readonly calendar: McpCalendarService;
}

/**
 * Everything one request of the calendar API works with: the account of
 * the paired machine, whether it may only read, and the calendar service.
 */
export class McpCalendarContext {
  public readonly actor: User;
  public readonly isReadOnly: boolean;
  public readonly calendar: McpCalendarService;

  /**
   * Creates the context of one request.
   *
   * @param input - Account, read-only flag and calendar service.
   */
  public constructor(input: McpCalendarContextInput) {
    this.actor = input.actor;
    this.isReadOnly = input.isReadOnly;
    this.calendar = input.calendar;
  }

  /**
   * Requires an account that may change the calendar.
   *
   * @throws {McpCalendarError} `forbidden` for an agent that may only read.
   *
   * @remarks
   * Checked before the operation journal is asked, so a read-only agent
   * neither changes anything nor learns a stored answer.
   */
  public requireWriter(): void {
    if (this.isReadOnly) throw new McpCalendarError("forbidden");
  }

  /**
   * Completes the target of a change or a deletion for the calendar service.
   *
   * @param eventId - The event or one of its occurrences, from the path.
   * @param target - Expected revision, scope and occurrence of the request.
   * @returns The target; a single event without a scope counts as `all`.
   * @throws {McpCalendarError} `invalid_request` for a series without a scope.
   * @throws {CalendarError} `not_found` for a missing or invisible event.
   */
  public async target(
    eventId: string,
    target: McpCalendarTarget,
  ): Promise<CalendarTargetRequest> {
    const request = {
      id: eventId,
      expectedRevision: target.expectedRevision,
      occurrenceStart: target.occurrenceStart ?? null,
    };
    if (target.scope !== undefined) return { ...request, scope: target.scope };
    const event = await this.calendar.readEvent(this.actor, eventId);
    if (event.recurrence !== null)
      throw new McpCalendarError("invalid_request");
    return { ...request, scope: "all" };
  }
}
